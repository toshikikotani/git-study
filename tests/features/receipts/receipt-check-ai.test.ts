import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import type { ReceiptCheckEntry } from '@/domain/receipt-check';

vi.mock('@/lib/ai-gateway/settings', () => ({ isAiEnabled: async () => true }));

import {
  aiIssuesToFixes,
  findReceiptMistakesWithAi,
  RECEIPT_CHECK_MODEL,
  RECEIPT_CHECK_SYSTEM_PROMPT,
  type ReceiptAiIssue,
} from '@/features/receipts/receipt-check-ai';

/**
 * レシートの品目の読み取りミスを AI で見つける(ADR-120)。AI は提案だけで、
 * 保存は本人が選んで押したものだけ。
 */

const entries: ReceiptCheckEntry[] = [
  {
    transactionId: 'tx-1',
    occurredOn: '2026-10-17',
    amountYen: -350,
    storeName: 'ライフ',
    reconcileDiffYen: -120,
    items: [
      { id: 'i-0', name: '牛孚L', amountYen: -200, genreId: null, productType: null },
      { id: 'i-1', name: 'パン', amountYen: -150, genreId: null, productType: null },
    ],
  },
];

function issue(patch: Partial<ReceiptAiIssue>): ReceiptAiIssue {
  return {
    receipt: 0,
    item: 0,
    kind: 'rename',
    name: '牛乳',
    amountYen: null,
    reason: '文字の読み違いのようです',
    ...patch,
  };
}

function client(parse: ReturnType<typeof vi.fn>) {
  return { beta: { messages: { parse } }, messages: { parse: vi.fn() } } as unknown as Anthropic;
}

describe('AI の返事を候補にする(AI を信用しきらない)', () => {
  it('品名の直し・行を消す・金額の直しを、品目の id につなぐ', () => {
    const fixes = aiIssuesToFixes(
      [
        issue({}),
        issue({ item: 1, kind: 'remove', name: null }),
        issue({ item: 1, kind: 'amount', name: null, amountYen: 1500 }),
      ],
      entries,
    );
    expect(fixes.map((f) => [f.itemId, f.kind, f.name, f.amountYen, f.source])).toEqual([
      ['i-0', 'rename', '牛乳', null, 'ai'],
      ['i-1', 'remove', null, null, 'ai'],
      ['i-1', 'amount', null, 1500, 'ai'],
    ]);
  });

  it('無い番号・空や同じ品名・同じ金額・0円以下の金額は捨てる', () => {
    expect(
      aiIssuesToFixes(
        [
          issue({ receipt: 5 }),
          issue({ item: 9 }),
          issue({ name: '  ' }),
          issue({ name: '牛孚L' }),
          issue({ kind: 'amount', name: null, amountYen: 200 }),
          issue({ kind: 'amount', name: null, amountYen: 0 }),
          issue({ kind: 'amount', name: null, amountYen: null }),
        ],
        entries,
      ),
    ).toEqual([]);
  });

  it('理由が空なら、決まった理由を入れる', () => {
    expect(aiIssuesToFixes([issue({ reason: ' ' })], entries)[0]!.reason).toBe(
      '品名を読み違えているようです',
    );
  });

  it('按分のずれ・レシートらしい略し方・2つ買ったものは出さないように頼む', () => {
    expect(RECEIPT_CHECK_SYSTEM_PROMPT).toContain('支払額に按分した値');
    expect(RECEIPT_CHECK_SYSTEM_PROMPT).toContain('読み取りミスではないので出さない');
    expect(RECEIPT_CHECK_SYSTEM_PROMPT).toContain('2つ買うことはよくあるので出さない');
    expect(RECEIPT_CHECK_SYSTEM_PROMPT).toContain('迷うものは出さない');
  });
});

describe('AI で探す', () => {
  it(`${RECEIPT_CHECK_MODEL} に、店名・支払額・品目だけを送る(日付は送らない)`, async () => {
    const parse = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { issues: [issue({})] },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const result = await findReceiptMistakesWithAi(entries, 'key', client(parse));
    expect(result.warning).toBeNull();
    expect(result.fixes.map((f) => f.key)).toEqual(['ai:tx-1:i-0:rename']);
    const args = parse.mock.calls[0]![0];
    expect(args.model).toBe('claude-opus-5-5');
    expect(args.fallbacks).toBe('default');
    const content = args.messages[0].content as string;
    expect(content).toContain('#R0 店=ライフ 支払=350円 照合のずれ=120円');
    expect(content).toContain('  0: 牛孚L 200円');
    expect(content).not.toContain('2026-10-17');
  });

  it('AI が失敗したら、候補は空で理由を返す(画面は止めない)', async () => {
    const parse = vi.fn().mockRejectedValue(new Error('boom'));
    const result = await findReceiptMistakesWithAi(entries, 'key', client(parse));
    expect(result.fixes).toEqual([]);
    expect(result.warning).toBeTruthy();
  });

  it('レシートが無ければ AI を呼ばない', async () => {
    const parse = vi.fn();
    expect(await findReceiptMistakesWithAi([], 'key', client(parse))).toEqual({
      fixes: [],
      warning: null,
    });
    expect(parse).not.toHaveBeenCalled();
  });
});
