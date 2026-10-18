import { describe, expect, it } from 'vitest';

import {
  groupMerchantNameReview,
  type MerchantNameReviewEntry,
} from '@/domain/merchant-name-review';

function entry(
  id: string,
  label: string | null,
  patch: Partial<MerchantNameReviewEntry> = {},
): MerchantNameReviewEntry {
  return {
    id,
    merchantName: label,
    description: '',
    branchName: null,
    updatedAt: '2026-10-18T00:00:00Z',
    occurredOn: '2026-10-18',
    amountYen: -100,
    ...patch,
  };
}

describe('店名をまとめて確認する候補', () => {
  it('チェーン表記と明示されたスキ薬局のゆれを支店付きで提示する', () => {
    const groups = groupMerchantNameReview([
      entry('a', 'スキ薬局豊津店'),
      entry('b', 'ファミマ KITTE大阪店'),
    ]);
    expect(groups).toMatchObject([
      {
        label: 'スキ薬局豊津店',
        suggestedName: 'スギ薬局',
        suggestedBranch: '豊津店',
        reasons: ['normalization'],
      },
      { suggestedName: 'ファミリーマート', suggestedBranch: 'KITTE大阪店' },
    ]);
  });

  it('同じ表示名と支店の明細をまとめ、別支店は混ぜず、スナップショットを残す', () => {
    const first = entry('a', 'ファミマ', { description: '一回目', branchName: '豊津店' });
    const second = entry('b', 'ファミマ', { description: '二回目', branchName: '豊津店' });
    const third = entry('c', 'ファミマ', { branchName: '梅田店' });
    const groups = groupMerchantNameReview([first, second, third]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      branchName: '豊津店',
      suggestedBranch: '豊津店',
      entries: [first, second],
    });
    expect(groups[1]?.entries).toEqual([third]);
  });

  it('空欄と名称不明を候補にし、有効なdescriptionへのフォールバックは維持する', () => {
    const groups = groupMerchantNameReview([
      entry('a', null),
      entry('b', '店名なし'),
      entry('c', '不明'),
      entry('d', null, { description: 'スギ薬局' }),
      entry('e', '  ', { description: '近畿日本鉄道' }),
      entry('f', null, { description: '(店名不明)' }),
      entry('g', '名称なし'),
      entry('h', '（店名不明）'),
    ]);
    expect(groups).toHaveLength(6);
    expect(
      groups.every((group) => group.reasons[0] === 'missing' && group.suggestedName === ''),
    ).toBe(true);
  });

  it('住所から店を推測せず、修正する名前は空欄で提示する', () => {
    const groups = groupMerchantNameReview([
      entry('a', '大阪府吹田市豊津町1丁目2番3号'),
      entry('b', '吹田市豊津町1-2-3'),
      entry('c', '〒564-0051 大阪府吹田市豊津町'),
      entry('d', '山下駅 タイムズ駐車場'),
      entry('e', '大阪府吹田市豊津町１丁目２番３号'),
    ]);
    expect(groups).toHaveLength(4);
    expect(
      groups.every((group) => group.reasons[0] === 'address' && group.suggestedName === ''),
    ).toBe(true);
  });

  it('株式会社の省略だけで候補を増やさず、既に正しい店名も残さない', () => {
    expect(
      groupMerchantNameReview([
        entry('a', '株式会社近畿日本鉄道'),
        entry('b', '近畿日本鉄道株式会社'),
        entry('c', '株式会社スギ薬局'),
        entry('d', 'スギ薬局', { branchName: '豊津店' }),
        entry('e', '近畿日本鉄道'),
      ]),
    ).toEqual([]);
  });

  it('読み取り元の名前と金額を変更しない', () => {
    const original = entry('a', 'スキ薬局豊津店');
    const snapshot = structuredClone(original);
    groupMerchantNameReview([original]);
    expect(original).toEqual(snapshot);
  });
});
