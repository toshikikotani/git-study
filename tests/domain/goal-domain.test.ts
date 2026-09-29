import { describe, expect, it } from 'vitest';

import {
  goalImpact,
  goalToastMessage,
  needsKindChoice,
  type GoalSnapshot,
} from '@/domain/goal-impact';
import { buildGoalReview, nextPlanTargets } from '@/domain/goal-review';
import { buildPlanEvidence, dailySeries, medianOf } from '@/domain/plan-evidence';
import { planPreset, DEFAULT_PLAN_PRESET } from '@/domain/plan-presets';

const goal: GoalSnapshot = {
  range: { from: '2026-09-29', to: '2026-10-05' },
  genres: [
    { genreId: 'dining', genreName: '外食', targetYen: 7900, spentYen: 5000 },
    { genreId: 'food', genreName: '食料品', targetYen: 14000, spentYen: 2000 },
    { genreId: 'zero', genreName: '酒', targetYen: 0, spentYen: 0 },
  ],
};
const TODAY = '2026-09-30';

describe('goalImpact(受け入れ基準8:保存前 → 保存後の残り予算)', () => {
  it('影響するジャンルの、保存前と保存後の残りを出す', () => {
    const r = goalImpact(goal, {
      occurredOn: TODAY,
      today: TODAY,
      kind: 'normal',
      deltas: [{ genreId: 'dining', amountYen: 1500 }],
    });
    expect(r.counts).toBe(true);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      genreName: '外食',
      beforeRemainingYen: 2900,
      afterRemainingYen: 1400,
      state: 'caution', // 6,500 / 7,900 = 82%
    });
  });

  it('目標のないジャンル(予算0円)は影響の行に出さない', () => {
    const r = goalImpact(goal, {
      occurredOn: TODAY,
      today: TODAY,
      kind: 'normal',
      deltas: [{ genreId: 'zero', amountYen: 500 }],
    });
    expect(r.rows).toEqual([]);
    expect(r.reason).toBe('no_target');
  });

  it('特別費・予定・期間外は、目標のペースに数えない(残りは変わらない)', () => {
    const base = { today: TODAY, deltas: [{ genreId: 'dining', amountYen: 26540 }] };
    const special = goalImpact(goal, { ...base, occurredOn: TODAY, kind: 'special' });
    expect(special).toMatchObject({ counts: false, reason: 'special' });
    expect(special.rows[0]!.afterRemainingYen).toBe(special.rows[0]!.beforeRemainingYen);
    expect(goalImpact(goal, { ...base, occurredOn: '2026-10-03', kind: 'normal' }).reason).toBe(
      'scheduled',
    );
    expect(goalImpact(goal, { ...base, occurredOn: '2026-09-01', kind: 'normal' }).reason).toBe(
      'outside_period',
    );
  });
});

describe('needsKindChoice(含める/特別費を選ばせる条件)', () => {
  it('未来日、またはそのジャンルの予算の50%以上なら選ばせる', () => {
    const t = { today: TODAY };
    expect(
      needsKindChoice(goal, {
        ...t,
        occurredOn: '2026-10-03',
        deltas: [{ genreId: 'dining', amountYen: 100 }],
      }),
    ).toEqual({ needed: true, reason: 'scheduled' });
    expect(
      needsKindChoice(goal, {
        ...t,
        occurredOn: TODAY,
        deltas: [{ genreId: 'dining', amountYen: 3950 }],
      }),
    ).toEqual({ needed: true, reason: 'large' });
    expect(
      needsKindChoice(goal, {
        ...t,
        occurredOn: TODAY,
        deltas: [{ genreId: 'dining', amountYen: 3949 }],
      }).needed,
    ).toBe(false);
  });

  it('目標が無ければ選ばせない', () => {
    expect(
      needsKindChoice(null, { today: TODAY, occurredOn: '2026-10-03', deltas: [] }).needed,
    ).toBe(false);
  });
});

describe('goalToastMessage(叱らず、超過額と明日からの目安を1文で)', () => {
  it('目安を超えたら、超過額と明日からの1日の目安', () => {
    const impact = goalImpact(goal, {
      occurredOn: TODAY,
      today: TODAY,
      kind: 'normal',
      deltas: [{ genreId: 'dining', amountYen: 3900 }],
    });
    const msg = goalToastMessage({ label: "TULLY'S 3,900円", impact, goal, today: TODAY });
    // 外食 8,900 / 7,900 → 1,000円超過。残り: (7,900+14,000) − (8,900+2,000) = 11,000 ÷ 明日以降 5日(10/1〜10/5) = 2,200
    expect(msg).toContain('外食が目安を1,000円超えました');
    expect(msg).toContain('明日からは1日2,200円が目安です');
    expect(msg).not.toMatch(/ダメ|失敗|注意してください|使いすぎ/);
  });

  it('超えていなければ残りを伝える。特別費なら含めない理由を伝える', () => {
    const inc = goalImpact(goal, {
      occurredOn: TODAY,
      today: TODAY,
      kind: 'normal',
      deltas: [{ genreId: 'dining', amountYen: 500 }],
    });
    expect(goalToastMessage({ label: 'A', impact: inc, goal, today: TODAY })).toContain(
      '外食の残りは2,400円です',
    );
    const sp = goalImpact(goal, {
      occurredOn: TODAY,
      today: TODAY,
      kind: 'special',
      deltas: [{ genreId: 'dining', amountYen: 500 }],
    });
    expect(goalToastMessage({ label: 'A', impact: sp, goal, today: TODAY })).toContain(
      '特別費として別枠',
    );
  });
});

describe('振り返り', () => {
  const items = [
    { genreId: 'dining', genreName: '外食', targetYen: 8000 },
    { genreId: 'food', genreName: '食料品', targetYen: 14000 },
    { genreId: 'cafe', genreName: 'カフェ・飲料', targetYen: 3000 },
  ];
  const actual = new Map([
    ['dining', 10000],
    ['food', 9000],
    ['cafe', 3000],
  ]);
  const review = buildGoalReview({ items, actualByGenre: actual });

  it('うまくいった点1つと、次に見直すジャンル1つ', () => {
    expect(review.goodPoint).toBe('食料品は目標より5,000円少なく収まりました。');
    expect(review.reviewGenre).toMatchObject({ genreName: '外食' });
    expect(review.reviewGenre!.reason).toContain('2,000円多く');
  });

  it('全部達成なら、余りを伝え、いちばん余裕の少ないジャンルを次の見直しに', () => {
    const r = buildGoalReview({
      items,
      actualByGenre: new Map([
        ['dining', 7000],
        ['food', 9000],
        ['cafe', 3000],
      ]),
    });
    expect(r.goodPoint).toContain('すべてのジャンルが目標内');
    expect(r.reviewGenre!.genreName).toBe('カフェ・飲料');
  });

  it('次の目標案:超えたら中間、大きく下回ったら実績に合わせる、他は継続', () => {
    const next = nextPlanTargets(review);
    expect(next.get('dining')).toBe(9000); // 8,000 と 10,000 の中間
    expect(next.get('food')).toBe(9500); // 実績9,000 × 1.05 = 9,450 → 9,500
    expect(next.get('cafe')).toBe(3000);
    expect([...nextPlanTargets(review, 2).values()][0]).toBe(18000);
  });
});

describe('提案の根拠・プリセット', () => {
  it('中央値と、記録が14日未満なら暫定', () => {
    expect(medianOf([5, 1, 3])).toBe(3);
    expect(medianOf([1, 2, 3, 10])).toBe(3);
    const byDay = new Map([
      ['2026-09-20', 1000],
      ['2026-09-22', 3000],
    ]);
    expect(dailySeries(byDay, '2026-09-20', '2026-09-22')).toEqual([1000, 0, 3000]);
    const e = buildPlanEvidence({
      recordedDates: ['2026-09-20', '2026-09-22'],
      totalByDay: byDay,
      today: '2026-09-22',
    });
    expect(e).toMatchObject({
      recordedDays: 2,
      from: '2026-09-20',
      medianDailyYen: 1000,
      provisional: true,
    });
    const many = buildPlanEvidence({
      recordedDates: Array.from(
        { length: 14 },
        (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`,
      ),
      totalByDay: new Map(),
      today: '2026-09-14',
    });
    expect(many.provisional).toBe(false);
  });

  it('プリセット:初期は「1週間」、給料日までは次の給料日の前日', () => {
    expect(DEFAULT_PLAN_PRESET).toBe('one_week');
    expect(planPreset('one_week', '2026-09-29', 25)).toEqual({
      start: '2026-09-29',
      end: '2026-10-05',
    });
    expect(planPreset('until_payday', '2026-09-29', 25)).toEqual({
      start: '2026-09-29',
      end: '2026-10-24',
    });
    expect(planPreset('month_end', '2026-09-29', 25).end).toBe('2026-09-30');
  });
});
