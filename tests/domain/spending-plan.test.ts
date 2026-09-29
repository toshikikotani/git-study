import { describe, expect, it } from 'vitest';

import {
  baselineForPeriod,
  clampAiTarget,
  fallbackTarget,
  nextPlanRange,
  planGuidance,
  planPeriodDays,
  rebalanceToTotal,
  planProgress,
} from '@/domain/spending-plan';

describe('planPeriodDays', () => {
  it('開始日と終了日を含めて数える', () => {
    expect(planPeriodDays('2026-09-29', '2026-09-29')).toBe(1);
    expect(planPeriodDays('2026-10-01', '2026-10-31')).toBe(31);
  });
});

describe('baselineForPeriod', () => {
  it('1日あたりの平均 × 期間の日数', () => {
    expect(baselineForPeriod(90000, 90, 30)).toBe(30000);
  });

  it('実績が無ければ0', () => {
    expect(baselineForPeriod(0, 30, 30)).toBe(0);
    expect(baselineForPeriod(1000, 0, 30)).toBe(0);
  });
});

describe('fallbackTarget', () => {
  it('課題のあるジャンルだけ、削れる部分をstepPercent削る', () => {
    expect(fallbackTarget({ baselineYen: 30000, mustPayShare: 0, isIssue: true }, 10)).toBe(27000);
    expect(fallbackTarget({ baselineYen: 30000, mustPayShare: 0, isIssue: false }, 10)).toBe(30000);
  });

  it('必須ラベルの部分は削らない', () => {
    // 削れるのは 30000 × (1-0.5) = 15000 の10% = 1500
    expect(fallbackTarget({ baselineYen: 30000, mustPayShare: 0.5, isIssue: true }, 10)).toBe(
      28500,
    );
  });

  it('実績が無ければ0', () => {
    expect(fallbackTarget({ baselineYen: 0, mustPayShare: 0, isIssue: true }, 10)).toBe(0);
  });
});

describe('clampAiTarget', () => {
  const facts = { baselineYen: 30000, mustPayShare: 0, isIssue: true };

  it('実績より増やさない', () => {
    expect(clampAiTarget(50000, facts, 10)).toBe(30000);
  });

  it('いきなり大きく削らない(stepPercentが下限)', () => {
    expect(clampAiTarget(5000, facts, 10)).toBe(27000);
    expect(clampAiTarget(5000, facts, 20)).toBe(24000);
  });

  it('範囲内の提案は100円単位に丸めて採用する', () => {
    expect(clampAiTarget(28430, facts, 10)).toBe(28400);
  });

  it('必須ラベルの部分は下限に含める', () => {
    expect(clampAiTarget(0, { baselineYen: 30000, mustPayShare: 1, isIssue: true }, 20)).toBe(
      30000,
    );
  });
});

describe('planProgress', () => {
  it('使用率と残りを返し、超過は over', () => {
    expect(planProgress(5000, 10000)).toMatchObject({ remainingYen: 5000, tone: 'normal' });
    expect(planProgress(7000, 10000).tone).toBe('attention');
    expect(planProgress(12000, 10000)).toMatchObject({ remainingYen: -2000, tone: 'over' });
  });

  it('目標が0円なら使用率は null', () => {
    expect(planProgress(0, 0).ratio).toBeNull();
  });
});

describe('nextPlanRange', () => {
  it('1回目は開始日、2回目は終了日になる', () => {
    const first = nextPlanRange({ start: null, end: null }, '2026-10-05');
    expect(first).toEqual({ start: '2026-10-05', end: null });
    expect(nextPlanRange(first, '2026-10-20')).toEqual({ start: '2026-10-05', end: '2026-10-20' });
  });

  it('開始日と同じ日をタップすると1日だけの期間になる', () => {
    expect(nextPlanRange({ start: '2026-10-05', end: null }, '2026-10-05')).toEqual({
      start: '2026-10-05',
      end: '2026-10-05',
    });
  });

  it('開始日より前をタップしたら開始日を選び直す', () => {
    expect(nextPlanRange({ start: '2026-10-05', end: null }, '2026-10-01')).toEqual({
      start: '2026-10-01',
      end: null,
    });
  });

  it('選び終わった後のタップは、その日から選び直す', () => {
    expect(nextPlanRange({ start: '2026-10-05', end: '2026-10-20' }, '2026-10-25')).toEqual({
      start: '2026-10-25',
      end: null,
    });
  });
});

describe('rebalanceToTotal', () => {
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

  it('差額を現在の金額の比率で配り、合計を総額にそろえる', () => {
    const result = rebalanceToTotal([20000, 10000], 36000);
    expect(sum(result)).toBe(36000);
    expect(result).toEqual([24000, 12000]);
  });

  it('減らす場合も比率で引く', () => {
    expect(rebalanceToTotal([20000, 10000], 24000)).toEqual([16000, 8000]);
  });

  it('すでに総額と同じなら変えない', () => {
    expect(rebalanceToTotal([1000, 2000], 3000)).toEqual([1000, 2000]);
  });

  it('重みを渡せば、その比率で配る', () => {
    expect(rebalanceToTotal([0, 0], 10000, [3, 1])).toEqual([7500, 2500]);
  });

  it('100円未満の端数は重みが最大のジャンルに載せる', () => {
    const result = rebalanceToTotal([10000, 10000], 20050, [1, 2]);
    expect(sum(result)).toBe(20050);
    expect(result[1]! - 10000).toBeGreaterThan(result[0]! - 10000);
  });

  it('減らしても0円未満にせず、足りない分は他のジャンルから引く', () => {
    const result = rebalanceToTotal([1000, 50000], 30000, [100, 1]);
    expect(sum(result)).toBe(30000);
    expect(result.every((x) => x >= 0)).toBe(true);
  });

  it('すべて0円なら均等に配る', () => {
    expect(rebalanceToTotal([0, 0, 0], 3000)).toEqual([1000, 1000, 1000]);
  });

  it('どんな入力でも合計は総額に一致し、負にならない', () => {
    const cases: [number[], number][] = [
      [[33300, 12300, 4500, 0], 41000],
      [[100, 100, 100], 50],
      [[99999, 1], 0],
      [[5000, 5000, 5000], 123456],
      [[1, 2, 3], 700],
    ];
    for (const [amounts, total] of cases) {
      const result = rebalanceToTotal(amounts, total);
      expect(sum(result)).toBe(total);
      expect(result.every((x) => x >= 0)).toBe(true);
    }
  });
});

describe('rebalanceToTotal(ランダム入力)', () => {
  it('300通りの入力すべてで、合計が総額に一致し負にならない', () => {
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let n = 0; n < 300; n++) {
      const count = 1 + (next() % 8);
      const amounts = Array.from({ length: count }, () => (next() % 3 === 0 ? 0 : next() % 90000));
      const total = next() % 200000;
      const result = rebalanceToTotal(amounts, total);
      expect(result.reduce((a, b) => a + b, 0)).toBe(total);
      expect(result.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
    }
  });
});

describe('planGuidance', () => {
  const base = { periodStart: '2026-10-01', periodEnd: '2026-10-30' };
  const items = [
    { genreId: 'g1', genreName: '外食', targetYen: 30000, spentYen: 20000 },
    { genreId: 'g2', genreName: '食料品', targetYen: 30000, spentYen: 6000 },
  ];

  it('始まる前は開始までの日数と目標額を示す', () => {
    const g = planGuidance({ ...base, today: '2026-09-28', items });
    expect(g.status).toBe('not_started');
    expect(g.headline).toContain('3日後に始まります');
    expect(g.elapsedDays).toBe(0);
  });

  it('ペースが速いジャンルは期間末の超過見込みと1日の使える額を出す', () => {
    // 10日経過(10/10): 外食は2000円/日 → 期間末60000円見込み(目標30000円)
    const g = planGuidance({ ...base, today: '2026-10-10', items });
    const dining = g.genres.find((x) => x.genreId === 'g1')!;
    expect(dining.status).toBe('over_pace');
    expect(dining.projectedYen).toBe(60000);
    expect(dining.projectedOverYen).toBe(30000);
    expect(dining.dailyAllowanceYen).toBe(476); // 残り10000円 ÷ 残り21日(今日を含む)
    expect(dining.message).toContain('30,000円超える見込み');
    expect(g.actions[0]).toContain('外食');
  });

  it('順調なジャンルは行動指針に出さない', () => {
    const g = planGuidance({ ...base, today: '2026-10-10', items });
    expect(g.genres.find((x) => x.genreId === 'g2')!.status).toBe('on_track');
    expect(g.actions.some((a) => a.startsWith('食料品'))).toBe(false);
  });

  it('目標を超えたら over、残りの使える額は0円', () => {
    const g = planGuidance({
      ...base,
      today: '2026-10-20',
      items: [{ genreId: 'g1', genreName: '外食', targetYen: 10000, spentYen: 12000 }],
    });
    expect(g.genres[0]).toMatchObject({ status: 'over', dailyAllowanceYen: 0 });
    expect(g.genres[0]!.message).toContain('2,000円超えています');
  });

  it('期間が終わったら結果だけを示す', () => {
    const g = planGuidance({ ...base, today: '2026-11-05', items });
    expect(g.status).toBe('ended');
    expect(g.dailyAllowanceYen).toBeNull();
    expect(g.remainingDays).toBe(0);
  });

  it('全体の目安と実績を比べる', () => {
    const g = planGuidance({ ...base, today: '2026-10-15', items });
    expect(g.expectedByTodayYen).toBe(30000); // 60000 × 15/30
  });
});

describe('planGuidance(目標との連携の規則)', () => {
  const period = { periodStart: '2026-09-29', periodEnd: '2026-10-05' }; // 7日間

  it('予算0円のジャンルに「順調です」「1日0円まで」を出さない(受け入れ基準6)', () => {
    const g = planGuidance({
      ...period,
      today: '2026-10-02',
      items: [
        { genreId: 'g1', genreName: '外食', targetYen: 7000, spentYen: 1000 },
        { genreId: 'g0', genreName: '酒', targetYen: 0, spentYen: 0 },
        { genreId: 'g00', genreName: '旅行', targetYen: 0, spentYen: 3000 },
      ],
    });
    for (const id of ['g0', 'g00']) {
      const x = g.genres.find((y) => y.genreId === id)!;
      expect(x.status).toBe('no_budget');
      expect(x.message).toBe('');
      expect(x.dailyAllowanceYen).toBeNull();
    }
    const all = [g.headline, ...g.actions, ...g.genres.map((y) => y.message)].join('\n');
    expect(all).not.toContain('1日0円');
    expect(all).not.toMatch(/酒|旅行/);
  });

  it('予算なしのジャンルは、目標の合計にも実績の合計にも入れない', () => {
    const g = planGuidance({
      ...period,
      today: '2026-10-02',
      items: [
        { genreId: 'g1', genreName: '外食', targetYen: 7000, spentYen: 1000 },
        { genreId: 'g00', genreName: '旅行', targetYen: 0, spentYen: 3000 },
      ],
    });
    expect(g.targetYen).toBe(7000);
    expect(g.spentYen).toBe(1000);
  });

  it('経過3日未満は線形の見込みを出さず、理想ペースとの差(今日時点で±○円)を見せる', () => {
    // 1日目(9/29): 7日間・目標7,000円 → 理想 1,000円。実績 2,500円
    const g = planGuidance({
      ...period,
      today: '2026-09-29',
      items: [{ genreId: 'g1', genreName: '外食', targetYen: 7000, spentYen: 2500 }],
    });
    expect(g.showProjection).toBe(false);
    expect(g.projectedYen).toBeNull();
    expect(g.genres[0]!.projectedYen).toBeNull();
    expect(g.paceDiffYen).toBe(1500);
    expect(g.headline).toContain('理想ペースとの差');
    expect(g.headline).toContain('+1,500円');
    expect(g.headline).not.toContain('見込み');
  });

  it('3日目からは線形の見込みを出す', () => {
    const g = planGuidance({
      ...period,
      today: '2026-10-01',
      items: [{ genreId: 'g1', genreName: '外食', targetYen: 7000, spentYen: 3000 }],
    });
    expect(g.showProjection).toBe(true);
    expect(g.projectedYen).toBe(7000);
  });

  it('今日使える額 = 今日より前の実績で残りを割った1日の目安 − 今日すでに使った分', () => {
    // 10/1(3日目): 目標7,000円、ここまで 3,000円(うち今日 800円)。残り5日(今日を含む)
    // 今日より前の実績 2,200円 → (7,000 − 2,200) ÷ 5 = 960円/日 → 今日の残り 160円
    const g = planGuidance({
      ...period,
      today: '2026-10-01',
      items: [
        { genreId: 'g1', genreName: '外食', targetYen: 7000, spentYen: 3000, todaySpentYen: 800 },
      ],
    });
    expect(g.remainingDays).toBe(5);
    expect(g.todayAllowanceYen).toBe(160);
  });

  it('特別費・予定は別の値として持つ(ペースの実績には入らない)', () => {
    const g = planGuidance({
      ...period,
      today: '2026-09-29',
      items: [{ genreId: 'g1', genreName: '外食', targetYen: 7000, spentYen: 1000 }],
      specialYen: 26540,
      scheduledYen: 26540,
    });
    expect(g.spentYen).toBe(1000);
    expect(g.specialYen).toBe(26540);
    expect(g.scheduledYen).toBe(26540);
  });

  it('行動指針は要対応ジャンルの上位2件だけ', () => {
    const g = planGuidance({
      ...period,
      today: '2026-10-03',
      items: [
        { genreId: 'a', genreName: 'A', targetYen: 1000, spentYen: 2000 },
        { genreId: 'b', genreName: 'B', targetYen: 1000, spentYen: 3000 },
        { genreId: 'c', genreName: 'C', targetYen: 1000, spentYen: 4000 },
      ],
    });
    expect(g.actions).toHaveLength(2);
  });
});
