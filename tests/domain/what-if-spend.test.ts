import { describe, expect, it } from 'vitest';

import { jstClock, whatIfVerdict, type WhatIfSpend } from '@/domain/forecast/what-if-spend';

/** もし今日これだけ使ったら(デザイン v3-2、ADR-108)のひとこと。 */

const result = (prob: number, afterProb: number): WhatIfSpend => ({
  budgetYen: 172000,
  monthlySavingsTargetYen: 100000,
  base: {
    amountYen: 0,
    landingYen: 206000,
    probWithinBudget: prob,
    tomorrowYen: 1320,
    monthEndYen: 83000,
  },
  options: [
    {
      amountYen: 3000,
      landingYen: 209000,
      probWithinBudget: afterProb,
      tomorrowYen: 1160,
      monthEndYen: 80000,
    },
  ],
  computedAt: '10/17 12:35',
});

describe('whatIfVerdict', () => {
  it('目標がすでに難しいときは、この額では大きく変わらないと書き、貯金目標までの差を出す', () => {
    const r = result(0.01, 0.005);
    expect(whatIfVerdict(r, r.options[0]!)).toBe(
      '今期の目標の17.2万円はすでに難しい状況なので、この額で見通しは大きく変わりません。' +
        '明日からの目安は1日約1,200円になります。貯金目標まで、月末の見込みであと約2.0万円です。',
    );
  });

  it('確率が大きく下がるときは、前 → 後の確率を書く', () => {
    const r = result(0.6, 0.4);
    expect(whatIfVerdict(r, r.options[0]!)).toContain('目標内の確率が60%から40%に下がります。');
  });

  it('ほとんど変わらないときは、そう書く', () => {
    const r = result(0.6, 0.58);
    expect(whatIfVerdict(r, r.options[0]!)).toContain('今期の見通しはほとんど変わりません。');
  });
});

describe('jstClock', () => {
  it('日本時間の「10/17 12:35」', () => {
    expect(jstClock(new Date('2026-10-17T03:35:00Z'))).toBe('10/17 12:35');
  });
});
