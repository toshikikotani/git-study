/**
 * レシートの写真は自動で記録しない(本人「自動登録機能は完全廃止、必ずユーザーが確認する」、ADR-141)。
 * LINE・iPhone アプリの写真も、読み取って「保存前」(読めなければ入力待ち)に残すだけ。
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const s = vi.hoisted(() => ({
  kept: null as null | { readyIds: string[]; accountGuesses: object },
  keepInput: null as unknown,
  captures: [] as unknown[],
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'me' } } }) } }),
}));
vi.mock('@/features/genre/store', () => ({
  listGenres: async () => [
    { id: 'food', name: '食料品' },
    { id: 'daily', name: '日用品' },
  ],
}));
vi.mock('@/features/genre/memory-store', () => ({ loadClassificationMemory: async () => ({}) }));
vi.mock('@/features/genre/receipt-classify', () => ({
  classifyReceiptPipeline: async () => ({
    classifications: [
      { key: '0:0', genreId: 'daily', confidence: 0.9, source: 'dictionary' },
      { key: '0:1', genreId: 'food', confidence: 0.9, source: 'dictionary' },
    ],
    parentGenreIds: new Map(),
    warnings: [],
  }),
}));
vi.mock('@/features/import/receipt-storage', () => ({
  uploadReceiptImage: async () => ({ path: 'me/receipt.jpg' }),
}));
vi.mock('@/features/receipt-captures/keep-ready', () => ({
  keepReadyReceipts: async (input: unknown) => {
    s.keepInput = input;
    return s.kept;
  },
}));
vi.mock('@/features/receipt-captures/store', () => ({
  createCapture: async (input: unknown) => {
    s.captures.push(input);
    return 'cap-input';
  },
}));
// 写真から明細を入れる関数は呼ばれない(呼ばれたら落とす)。
vi.mock('@/features/transactions/store', () => ({
  importTransactions: () => {
    throw new Error('レシートを自動で記録しようとした');
  },
  importTransactionsAsAdmin: () => {
    throw new Error('レシートを自動で記録しようとした');
  },
}));

import { lineReceiptReply } from '@/features/import/line-receipt';
import {
  checkPathOf,
  keepReceiptPhotoForCheck,
  mainGenreId,
} from '@/features/receipt-captures/keep-photo';
import type { AiReceiptExtractor } from '@/features/import/receipt-ai';

const receipt = {
  occurredOn: '2026-10-27',
  description: 'ライフ 渋谷店',
  storeName: 'ライフ',
  amountYen: -1800,
  paymentMethod: 'one_time',
  items: [
    { description: 'ティッシュ', amountYen: -300 },
    { description: '牛乳', amountYen: -1500 },
  ],
  expenseSubtype: null,
};
const extractor = (transactions: unknown[], warnings: string[] = []): AiReceiptExtractor => ({
  extract: async () => ({ transactions, warnings }) as never,
});

beforeEach(() => {
  s.kept = { readyIds: ['cap-1'], accountGuesses: {} };
  s.keepInput = null;
  s.captures = [];
});

describe('写真を保存前に残す', () => {
  it('全部読めたら保存前に残し、明細にはしない。いちばん大きい品目のカテゴリを添える', async () => {
    const result = await keepReceiptPhotoForCheck({
      apiKey: 'k',
      extractor: extractor([receipt]),
      imageBase64: 'aW1n',
    });
    expect(result).toEqual({
      ready: [
        {
          id: 'cap-1',
          storeName: 'ライフ',
          occurredOn: '2026-10-27',
          amountYen: 1800,
          genreName: '食料品',
        },
      ],
      needsInputId: null,
      warnings: [],
      error: null,
    });
    expect(s.keepInput).toMatchObject({ imageBase64: 'aW1n', transactions: [receipt] });
    expect(checkPathOf(result)).toBe('/spending/review?receipt=cap-1');
  });

  it('読めなかったら入力待ちに残す(写真を見ながら入れる)', async () => {
    const result = await keepReceiptPhotoForCheck({
      apiKey: 'k',
      extractor: extractor([], ['合計が読めませんでした']),
      imageBase64: 'aW1n',
    });
    expect(result.ready).toEqual([]);
    expect(result.needsInputId).toBe('cap-input');
    expect(s.captures).toHaveLength(1);
    expect(checkPathOf(result)).toBe('/transactions/receipt/cap-input');
  });

  it('保存前に残せなければ、記録もせず理由を返す', async () => {
    s.kept = null;
    const result = await keepReceiptPhotoForCheck({
      apiKey: 'k',
      extractor: extractor([receipt]),
      imageBase64: 'aW1n',
    });
    expect(result.ready).toEqual([]);
    expect(result.error).toBe('保存前のレシートとして残せませんでした。');
  });

  it('品目が無ければ明細の分類、どれも無ければ店の種類', () => {
    const t = { ...receipt, items: [] } as never;
    expect(mainGenreId(t, 0, [{ key: '0', genreId: 'food', confidence: 1 }], {})).toBe('food');
    expect(mainGenreId(t, 0, [], { 0: 'daily' })).toBe('daily');
    expect(mainGenreId(t, 0, [], {})).toBeNull();
  });
});

describe('LINE への返事', () => {
  const kept = {
    ready: [
      {
        id: 'cap-1',
        storeName: 'ライフ',
        occurredOn: '2026-10-27',
        amountYen: 1800,
        genreName: null,
      },
    ],
    needsInputId: null,
    warnings: ['品目の一部が読めませんでした'],
    error: null,
  };

  it('読み取った内容と「まだ保存していません」、確かめる画面を開くボタン', () => {
    const message = lineReceiptReply(kept, 'https://kakeibo.example');
    expect(message).toEqual({
      type: 'text',
      text: [
        'レシートを読み取りました。まだ保存していません。',
        '10/27 ライフ 1,800円(カテゴリ未定)',
        '確かめて「保存」を押すと記録します。',
        '⚠ 品目の一部が読めませんでした',
      ].join('\n'),
      quickReply: {
        items: [
          {
            type: 'action',
            action: {
              type: 'uri',
              label: '確かめて保存',
              uri: 'https://kakeibo.example/spending/review?receipt=cap-1',
            },
          },
        ],
      },
    });
  });

  it('入力待ちは入力の画面へ。アプリの URL が無ければボタンなし', () => {
    const waiting = { ready: [], needsInputId: 'cap-9', warnings: [], error: null };
    const message = lineReceiptReply(waiting, 'https://kakeibo.example') as {
      text: string;
      quickReply: { items: { action: { label: string; uri: string } }[] };
    };
    expect(message.text).toContain('写真を見ながら入れてください');
    expect(message.quickReply.items[0]!.action).toMatchObject({
      label: '入力する',
      uri: 'https://kakeibo.example/transactions/receipt/cap-9',
    });
    const plain = lineReceiptReply(kept, null);
    expect(plain).not.toHaveProperty('quickReply');
    expect((plain as { text: string }).text).toContain(
      'アプリの「確認が必要」から確かめられます。',
    );
  });
});

describe('写真から自動で記録する経路がない', () => {
  it('LINE・iPhone アプリ・共通の処理は、明細を入れる関数を使わない', () => {
    for (const f of [
      'src/features/receipt-captures/keep-photo.ts',
      'src/features/import/line-receipt.ts',
      'app/api/webhooks/line/route.ts',
      'app/api/mobile/receipts/route.ts',
    ]) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/importTransactions|importReceiptPhoto|autoMergeSamePayments/);
    }
    const mobile = readFileSync('src/features/mobile/records.ts', 'utf8');
    const photo = mobile.slice(mobile.indexOf('export async function keepReceiptPhoto'));
    expect(photo.slice(0, photo.indexOf('\n}\n'))).not.toMatch(/importTransactions/);
  });
});
