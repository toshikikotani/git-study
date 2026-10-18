import { describe, expect, it } from 'vitest';

import { MAX_YEN } from '@/domain/money';
import {
  buildSplitPaymentRequest,
  isSplitPaymentEligible,
  type SplitPaymentEntry,
} from '@/domain/split-payment-request';

function entry(overrides: Partial<SplitPaymentEntry> = {}): SplitPaymentEntry {
  return {
    id: 'dinner',
    occurredOn: '2026-10-18',
    label: '夕食',
    branchName: null,
    amountYen: -3_000,
    status: 'actual',
    kind: 'normal',
    isTransfer: false,
    reviewStatus: 'confirmed',
    needsInput: false,
    ...overrides,
  };
}

describe('isSplitPaymentEligible', () => {
  it('通常の実績支出・特別費・カテゴリ確認待ちの支出を選べる', () => {
    expect(isSplitPaymentEligible(entry())).toBe(true);
    expect(isSplitPaymentEligible(entry({ kind: 'special' }))).toBe(true);
    expect(isSplitPaymentEligible(entry({ reviewStatus: 'pending' }))).toBe(true);
  });

  it.each<Partial<SplitPaymentEntry>>([
    { amountYen: 3_000 },
    { amountYen: 0 },
    { amountYen: -0.5 },
    { amountYen: Number.NaN },
    { amountYen: Number.NEGATIVE_INFINITY },
    { amountYen: -MAX_YEN - 1 },
    { status: 'scheduled' },
    { kind: 'refund' },
    { isTransfer: true },
    { reviewStatus: 'ignored' },
    { needsInput: true },
  ])('収入・予定・返金・振替などは選べない: %j', (overrides) => {
    expect(isSplitPaymentEligible(entry(overrides))).toBe(false);
  });
});

describe('buildSplitPaymentRequest', () => {
  it('親明細を合計し、自分を含む人数で割った文面を作る', () => {
    const result = buildSplitPaymentRequest(
      [
        entry({ branchName: '駅前店' }),
        entry({ id: 'taxi', label: 'タクシー', amountYen: -1_200 }),
      ],
      3,
    );

    expect(result).toMatchObject({
      totalYen: 4_200,
      participants: 3,
      amountPerPersonYen: 1_400,
      requesterShareYen: 1_400,
      remainderYen: 0,
    });
    expect(result.message).toBe(
      [
        '割り勘のお願い',
        '',
        '・2026/10/18 夕食 駅前店 3,000円',
        '・2026/10/18 タクシー 1,200円',
        '',
        '合計: 4,200円',
        '人数: 3人（私を含む）',
        '1人あたりの請求額: 1,400円',
        '端数はありません。',
        '',
        '1,400円をお願いします。',
      ].join('\n'),
    );
  });

  it('割り切れない場合は相手を同額とし、端数は自分が負担する', () => {
    const result = buildSplitPaymentRequest([entry({ amountYen: -1_000 })], 3);
    expect(result).toMatchObject({
      totalYen: 1_000,
      amountPerPersonYen: 333,
      requesterShareYen: 334,
      remainderYen: 1,
    });
    expect(result.message).toContain('端数1円は私が負担します。');
    expect(result.amountPerPersonYen * (result.participants - 1) + result.requesterShareYen).toBe(
      result.totalYen,
    );
  });

  it.each([
    [2, 2],
    [5, 3],
    [100, 7],
    [MAX_YEN, 3],
    [MAX_YEN, 999_983],
  ])('合計%s円・%s人で相手分と自分分の合計が元の額と一致する', (total, people) => {
    const result = buildSplitPaymentRequest([entry({ amountYen: -total })], people);
    expect(result.amountPerPersonYen).toBeGreaterThan(0);
    expect(Number.isSafeInteger(result.requesterShareYen)).toBe(true);
    expect(result.amountPerPersonYen * (people - 1) + result.requesterShareYen).toBe(total);
    expect(result.requesterShareYen - result.amountPerPersonYen).toBe(result.remainderYen);
    expect(result.remainderYen).toBeLessThan(people);
  });

  it('同じIDの明細を1件だけ数え、入力順を保つ', () => {
    const result = buildSplitPaymentRequest(
      [
        entry(),
        entry(),
        entry({ id: 'taxi', label: 'タクシー', amountYen: -1_000 }),
        entry({ amountYen: -2_000 }),
      ],
      2,
    );
    expect(result.entries.map((item) => item.id)).toEqual(['dinner', 'taxi']);
    expect(result.totalYen).toBe(4_000);
    expect(result.message.match(/2026\/10\/18 夕食/g)).toHaveLength(1);
  });

  it('カテゴリ分割・品目・メモ・口座・画像を加算も文面への転記もしない', () => {
    const withPrivateData = {
      ...entry({ amountYen: -4_000 }),
      splits: [{ amountYen: -2_000 }, { amountYen: -2_000 }],
      items: [{ name: '秘密の品目', amountYen: 6_000 }],
      memo: '秘密のメモ',
      accountId: 'private-account',
      thumbnailUrl: 'https://private.example/receipt',
    };
    const result = buildSplitPaymentRequest([withPrivateData], 2);
    expect(result.totalYen).toBe(4_000);
    expect(result.amountPerPersonYen).toBe(2_000);
    expect(result.entries[0]).toEqual(entry({ amountYen: -4_000 }));
    expect(result.message).not.toMatch(/秘密|private|6,000/);
    expect(withPrivateData.splits).toHaveLength(2);
  });

  it('店名と支店の改行・制御文字を空白にし、明細を1行ずつに保つ', () => {
    const original = entry({
      label: '  お店\n合計\t\u0000  ',
      branchName: '\r駅前\u202e店\u2028  ',
    });
    const result = buildSplitPaymentRequest([original], 2);
    expect(result.message).toContain('・2026/10/18 お店 合計 駅前 店 3,000円');
    expect(result.message.replaceAll('\n', '')).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    expect(original.label).toContain('\n');
  });

  it('空の店名や支店名も文面を崩さない', () => {
    const result = buildSplitPaymentRequest([entry({ label: ' \n ', branchName: '\t' })], 2);
    expect(result.message).toContain('・2026/10/18 名称なし 3,000円');
    expect(result.entries[0]?.branchName).toBeNull();
  });

  it('未選択は請求文を作らない', () => {
    expect(() => buildSplitPaymentRequest([], 2)).toThrow('明細を選んでください');
  });

  it.each([0, 1, -2, 2.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    '人数%sは拒否する',
    (people) => {
      expect(() => buildSplitPaymentRequest([entry()], people)).toThrow('2人以上の整数');
    },
  );

  it('1人分が0円になる場合は拒否する', () => {
    expect(() => buildSplitPaymentRequest([entry({ amountYen: -2 })], 3)).toThrow('1円以上');
  });

  it('選択された不正な明細を黙って除外しない', () => {
    expect(() =>
      buildSplitPaymentRequest([entry(), entry({ id: 'future', status: 'scheduled' })], 2),
    ).toThrow('実績の支出を選び直してください');
    expect(() => buildSplitPaymentRequest([entry({ id: ' ' })], 2)).toThrow('選び直してください');
    expect(() => buildSplitPaymentRequest([entry({ occurredOn: '2026/10/18' })], 2)).toThrow(
      'YYYY-MM-DD',
    );
  });

  it('合計が金額上限を超える場合は拒否する', () => {
    expect(() =>
      buildSplitPaymentRequest(
        [entry({ amountYen: -MAX_YEN }), entry({ id: 'extra', amountYen: -1 })],
        2,
      ),
    ).toThrow('割り勘の合計が上限を超えています');
  });
});
