import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  mergeMerchantNameGroups,
  type MerchantNameReviewEntry,
} from '@/domain/merchant-name-review';

vi.mock('@/lib/ai-gateway/settings', () => ({ isAiEnabled: async () => true }));

import {
  aiGroupsToReview,
  distinctMerchantLabels,
  findMerchantNameVariantsWithAi,
  MERCHANT_NAME_MODEL,
  MERCHANT_NAME_SYSTEM_PROMPT,
} from '@/features/transactions/merchant-name-ai';

/**
 * 店名の表記ゆれを AI で見つける(本人の要望「ai使ってスキャン」、ADR-119)。
 * AI は提案だけ。保存は本人が確かめて押したものだけ(ADR-116)。
 */

let seq = 0;
function entry(
  merchantName: string | null,
  branchName: string | null = null,
  description = merchantName ?? '',
): MerchantNameReviewEntry {
  seq += 1;
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
    merchantName,
    description,
    branchName,
    updatedAt: '2026-10-18T00:00:00Z',
    occurredOn: '2026-10-17',
    amountYen: -500,
  };
}

describe('AI に見せる店名', () => {
  it('同じ店名・支店は1つにまとめ、件数の多い順。店名なし・住所は見せない', () => {
    const labels = distinctMerchantLabels([
      entry('ｾﾌﾞﾝｲﾚﾌﾞﾝ'),
      entry('ｾﾌﾞﾝｲﾚﾌﾞﾝ'),
      entry('セブン-イレブン'),
      entry('スギ薬局', '豊津店'),
      entry(null, null, '店名なし'),
      entry('大阪府吹田市豊津町1-2'),
    ]);
    expect(labels).toEqual([
      { index: 0, name: 'ｾﾌﾞﾝｲﾚﾌﾞﾝ', branch: null, count: 2 },
      { index: 1, name: 'スギ薬局', branch: '豊津店', count: 1 },
      { index: 2, name: 'セブン-イレブン', branch: null, count: 1 },
    ]);
  });

  it('多すぎるときは件数の多いものから上限まで', () => {
    const many = Array.from({ length: 5 }, (_, i) => entry(`店${i}`));
    expect(distinctMerchantLabels(many, 3)).toHaveLength(3);
  });

  it('同じ店だと言えるものだけ・別の店はまとめない・支店は分ける、と頼む', () => {
    expect(MERCHANT_NAME_SYSTEM_PROMPT).toContain('迷うものはまとめない');
    expect(MERCHANT_NAME_SYSTEM_PROMPT).toContain('別の店をまとめない');
    expect(MERCHANT_NAME_SYSTEM_PROMPT).toContain('支店名は name に入れず branch に分ける');
  });
});

describe('AI のまとめを確認画面のグループにする', () => {
  const a = entry('ｾﾌﾞﾝｲﾚﾌﾞﾝ');
  const b = entry('SEVEN-ELEVEN');
  const c = entry('セブン-イレブン');
  const entries = [a, b, c];
  const labels = distinctMerchantLabels(entries);
  const idx = (name: string) => labels.find((l) => l.name === name)!.index;

  it('提案の店名にまとめ、すでに提案どおりの明細は外す', () => {
    const groups = aiGroupsToReview(
      [
        {
          labels: [idx('ｾﾌﾞﾝｲﾚﾌﾞﾝ'), idx('SEVEN-ELEVEN'), idx('セブン-イレブン')],
          name: 'セブン-イレブン',
          branch: null,
        },
      ],
      labels,
      entries,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ reasons: ['ai'], suggestedName: 'セブン-イレブン' });
    expect(groups[0]!.entries.map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('無い番号・空の店名・2つ目のまとめに入った同じ店名は使わない(AIを信用しきらない)', () => {
    const groups = aiGroupsToReview(
      [
        { labels: [999], name: 'X', branch: null },
        { labels: [idx('ｾﾌﾞﾝｲﾚﾌﾞﾝ')], name: '  ', branch: null },
        { labels: [idx('SEVEN-ELEVEN')], name: 'セブン-イレブン', branch: null },
        { labels: [idx('SEVEN-ELEVEN')], name: 'セブン', branch: null },
      ],
      labels,
      entries,
    );
    expect(groups.map((g) => g.suggestedName)).toEqual(['セブン-イレブン']);
  });

  it('AI のまとめを先に出し、同じ明細は規則のまとめから外す', () => {
    const ai = aiGroupsToReview(
      [{ labels: [idx('ｾﾌﾞﾝｲﾚﾌﾞﾝ')], name: 'セブン-イレブン', branch: null }],
      labels,
      entries,
    );
    const rule = [{ ...ai[0]!, key: 'rule', reasons: ['normalization' as const], entries: [a, c] }];
    const merged = mergeMerchantNameGroups(ai, rule);
    expect(merged.map((g) => g.key)).toEqual(['ai:0', 'rule']);
    expect(merged[1]!.entries.map((e) => e.id)).toEqual([c.id]);
  });
});

describe('AI で探す', () => {
  it(`${MERCHANT_NAME_MODEL} に、店名と件数だけを送る(金額・日付は送らない)。default の代わりのモデルも頼む`, async () => {
    const parse = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { groups: [{ labels: [0], name: 'セブン-イレブン', branch: null }] },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const client = {
      beta: { messages: { parse } },
      messages: { parse: vi.fn() },
    } as unknown as Anthropic;
    const e = entry('ｾﾌﾞﾝｲﾚﾌﾞﾝ');
    const result = await findMerchantNameVariantsWithAi([e], 'key', client);
    expect(result.warning).toBeNull();
    expect(result.groups[0]!.entries.map((x) => x.id)).toEqual([e.id]);
    const args = parse.mock.calls[0]![0];
    expect(args.model).toBe('claude-opus-5-5');
    expect(args.fallbacks).toBe('default');
    const content = args.messages[0].content as string;
    expect(content).toContain('#0 店名=ｾﾌﾞﾝｲﾚﾌﾞﾝ 件数=1');
    expect(content).not.toContain('500');
    expect(content).not.toContain('2026-10-17');
  });

  it('AI が失敗したら、まとめは空で理由を返す(画面は止めない)', async () => {
    const parse = vi.fn().mockRejectedValue(new Error('boom'));
    const client = {
      beta: { messages: { parse } },
      messages: { parse: vi.fn() },
    } as unknown as Anthropic;
    const result = await findMerchantNameVariantsWithAi([entry('ｾﾌﾞﾝｲﾚﾌﾞﾝ')], 'key', client);
    expect(result.groups).toEqual([]);
    expect(result.warning).toBeTruthy();
  });
});
