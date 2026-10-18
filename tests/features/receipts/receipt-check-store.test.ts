import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * レシートの読み取りミスを探す・直す(ADR-120)。探すのは読むだけ。直すのは、探したときから品目が
 * 変わっていないときだけ。
 */

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  listItems: vi.fn(),
  replaceItems: vi.fn(),
  findWithAi: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/features/receipts/items-store', () => ({
  listReceiptItemsForTransactionIds: mocks.listItems,
  replaceReceiptItems: mocks.replaceItems,
}));
vi.mock('@/features/receipts/receipt-check-ai', () => ({
  MAX_AI_RECEIPTS: 100,
  findReceiptMistakesWithAi: mocks.findWithAi,
}));

import { saveReceiptItemFix, scanReceipts } from '@/features/receipts/receipt-check-store';
import { saveReceiptItemFixAction } from '../../../app/(app)/spending/receipt-check-actions';

const TX = 'aaaaaaaa-0000-0000-0000-000000000001';
const I0 = 'bbbbbbbb-0000-0000-0000-000000000001';
const I1 = 'bbbbbbbb-0000-0000-0000-000000000002';

type Result = { data: unknown; error: { code: string; message: string } | null };
let calls: { table: string; method: string; args: unknown[] }[];
let missingReconcileColumn: boolean;

function builder(table: string, result: (columns: string) => Result) {
  let columns = '';
  const b: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'neq', 'order', 'range']) {
    b[method] = (...args: unknown[]) => {
      calls.push({ table, method, args });
      if (method === 'select') columns = String(args[0]);
      return b;
    };
  }
  b.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result(columns)).then(resolve, reject);
  return b;
}

function items() {
  return new Map([
    [
      TX,
      [
        {
          id: I0,
          name: '牛乳',
          amountYen: -200,
          genreId: 'food',
          genreName: '食費',
          productType: null,
        },
        {
          id: I1,
          name: '小計',
          amountYen: -200,
          genreId: null,
          genreName: null,
          productType: null,
        },
      ],
    ],
  ]);
}

beforeEach(() => {
  calls = [];
  missingReconcileColumn = false;
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  mocks.listItems.mockResolvedValue(items());
  mocks.replaceItems.mockResolvedValue(undefined);
  mocks.createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }) },
    from: (table: string) =>
      builder(table, (columns) => {
        if (table === 'receipt_items')
          return {
            data: [
              { transaction_id: TX, created_at: '2026-10-18T00:00:00Z' },
              { transaction_id: TX, created_at: '2026-10-18T00:00:00Z' },
            ],
            error: null,
          };
        if (missingReconcileColumn && columns.includes('reconcile_diff_yen'))
          return { data: null, error: { code: '42703', message: 'missing' } };
        return {
          data: [
            {
              id: TX,
              occurred_on: '2026-10-17',
              amount_yen: -400,
              merchant_name: null,
              description: 'ライフ 豊津店',
              ...(columns.includes('reconcile_diff_yen') ? { reconcile_diff_yen: null } : {}),
            },
          ],
          error: null,
        };
      }),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('探す(読むだけ)', () => {
  it('AI が使えないときは、規則で見つけた候補(品目ではない行)だけと理由を返す', async () => {
    const result = await scanReceipts();
    expect(result.warning).toContain('AIのレシートチェック');
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.entry).toMatchObject({
      transactionId: TX,
      storeName: 'ライフ 豊津店',
      amountYen: -400,
    });
    expect(result.groups[0]!.fixes.map((f) => [f.itemId, f.kind, f.source])).toEqual([
      [I1, 'remove', 'rule'],
    ]);
    expect(mocks.findWithAi).not.toHaveBeenCalled();
    expect(calls.some((c) => ['update', 'delete', 'insert'].includes(c.method))).toBe(false);
  });

  it('AI の候補を先に、規則の候補とまとめる(同じ品目・同じ直し方は AI のほう)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'key');
    mocks.findWithAi.mockResolvedValueOnce({
      fixes: [
        {
          key: 'ai:x',
          transactionId: TX,
          itemId: I1,
          kind: 'remove',
          name: null,
          amountYen: null,
          reason: 'AI',
          source: 'ai',
        },
      ],
      warning: null,
    });
    const result = await scanReceipts();
    expect(result.warning).toBeNull();
    expect(result.groups[0]!.fixes.map((f) => f.source)).toEqual(['ai']);
  });

  it('照合のずれの列が無い環境でも読める', async () => {
    missingReconcileColumn = true;
    const result = await scanReceipts();
    expect(result.groups[0]!.entry.reconcileDiffYen).toBeNull();
  });

  it('品目のあるレシートが無ければ、何も呼ばずに空', async () => {
    mocks.listItems.mockResolvedValueOnce(new Map());
    expect(await scanReceipts()).toEqual({ groups: [], warning: null });
  });
});

describe('直す(本人が選んだものだけ)', () => {
  const input = {
    transactionId: TX,
    expectedItemIds: [I0, I1],
    items: [{ name: '牛乳', amountYen: -400, genreId: 'food', productType: null }],
  };

  it('探したときから品目が変わっていなければ置き換える', async () => {
    await saveReceiptItemFix(input);
    expect(mocks.replaceItems).toHaveBeenCalledWith(TX, input.items);
  });

  it('品目が変わっていたら(ほかの画面で直したなど)保存しない', async () => {
    await expect(saveReceiptItemFix({ ...input, expectedItemIds: [I0] })).rejects.toThrow(
      '品目が変更されています',
    );
    expect(mocks.replaceItems).not.toHaveBeenCalled();
  });

  it('空の品名・0円・品目なしは受け付けない', async () => {
    for (const bad of [
      { ...input, items: [{ ...input.items[0]!, name: ' ' }] },
      { ...input, items: [{ ...input.items[0]!, amountYen: 0 }] },
      { ...input, items: [] },
    ])
      await expect(saveReceiptItemFix(bad)).rejects.toThrow('品目の名前と金額を確認してください');
    expect(mocks.replaceItems).not.toHaveBeenCalled();
  });

  it('アクションは失敗を言葉で返し、保存できたら明細を読み直させる', async () => {
    expect(await saveReceiptItemFixAction({ ...input, expectedItemIds: [I1, I0] })).toEqual({
      error: '品目が変更されています。閉じてからもう一度確かめてください。',
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(await saveReceiptItemFixAction(input)).toEqual({ error: null });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/spending');
  });
});
