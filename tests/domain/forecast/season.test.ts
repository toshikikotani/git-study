import { describe, expect, it } from 'vitest';

import { rateFactorSum, seasonalFactors } from '@/domain/forecast/model';
import type { VariableTrainingData } from '@/domain/forecast/types';
import { eachDay } from '@/domain/period';

/** from〜to の毎日、monthYen[月] ÷ 30 円ずつ使うデータ。 */
function series(from: string, to: string, perDay: (month: number) => number): VariableTrainingData {
  return {
    categoryId: 'c',
    categoryName: 'c',
    days: eachDay(from, to).map((date) => ({
      date,
      count: 1,
      amountYen: perDay(Number(date.slice(5, 7))),
    })),
  };
}

describe('seasonalFactors(月の季節の係数)', () => {
  it('記録のそろった月が12か月に満たなければ使わない(全部1.0)', () => {
    const result = seasonalFactors([series('2026-01-01', '2026-09-30', () => 1000)], '2026-09-30');
    expect(result.active).toBe(false);
    expect(result.factors.every((f) => f === 1)).toBe(true);
  });

  it('12月だけ支出が多い2年分のデータでは、12月の係数が1より大きく、他の月は1に近い', () => {
    const data = series('2024-10-01', '2026-09-30', (m) => (m === 12 ? 2000 : 1000));
    const result = seasonalFactors([data], '2026-09-30');
    expect(result.active).toBe(true);
    expect(result.factors[12]).toBeGreaterThan(1.3);
    expect(result.factors[5]).toBeLessThan(1);
    expect(result.factors[5]).toBeGreaterThan(0.8);
  });

  it('観測が1年分だけなら、半分しか信じない(2年分より控えめ)', () => {
    const oneYear = seasonalFactors(
      [series('2025-10-01', '2026-09-30', (m) => (m === 12 ? 2000 : 1000))],
      '2026-09-30',
    );
    const twoYears = seasonalFactors(
      [series('2024-10-01', '2026-09-30', (m) => (m === 12 ? 2000 : 1000))],
      '2026-09-30',
    );
    expect(oneYear.factors[12]).toBeLessThan(twoYears.factors[12]!);
  });

  it('係数は0.6〜1.6の範囲に収まる', () => {
    const data = series('2024-10-01', '2026-09-30', (m) => (m === 8 ? 20000 : 100));
    const result = seasonalFactors([data], '2026-09-30');
    expect(Math.max(...result.factors)).toBeLessThanOrEqual(1.6);
    expect(Math.min(...result.factors)).toBeGreaterThanOrEqual(0.6);
  });
});

describe('rateFactorSum(残り期間の回数の係数)', () => {
  const flat = { weekdayFactor: Array(7).fill(1), paydayFactor: 1, holidayFactor: 1 };

  it('係数がすべて1なら、日数と同じ', () => {
    expect(rateFactorSum(flat, ['2026-10-06', '2026-10-07', '2026-10-08'], null)).toBe(3);
  });

  it('祝日の係数は、振替休日・ハッピーマンデーにも掛かる', () => {
    const cat = { ...flat, holidayFactor: 2 };
    expect(rateFactorSum(cat, ['2026-10-12'], null)).toBe(2); // スポーツの日
    expect(rateFactorSum(cat, ['2026-10-13'], null)).toBe(1);
  });

  it('月の係数を掛ける', () => {
    const monthFactor = Array(13).fill(1);
    monthFactor[10] = 1.5;
    expect(rateFactorSum(flat, ['2026-10-06', '2026-10-07'], null, monthFactor)).toBe(3);
  });
});

import { fitModel, levelSigmaFor } from '@/domain/forecast/model';

describe('金額の事前分布(カテゴリごとの金額の大きさを、他のカテゴリへ引き寄せない)', () => {
  /** 毎日 small 円のカテゴリと、6日おきに big 円のカテゴリ(90日分)。 */
  function twoCategories(small: number, big: number): VariableTrainingData[] {
    const dates = eachDay('2026-07-01', '2026-09-28');
    return [
      {
        categoryId: 'small',
        categoryName: '少額',
        days: dates.map((date) => ({ date, count: 1, amountYen: small })),
      },
      {
        categoryId: 'big',
        categoryName: '高額',
        days: dates.map((date, i) => ({
          date,
          count: i % 6 === 0 ? 1 : 0,
          amountYen: i % 6 === 0 ? big : 0,
        })),
      },
    ];
  }

  it('高額なカテゴリの1回の平均額が、全カテゴリの平均へ大きく引き下げられない', () => {
    const fitted = fitModel({
      variable: twoCategories(500, 5000),
      today: '2026-09-28',
      payday: null,
    });
    const big = fitted.categories.find((c) => c.categoryId === 'big')!;
    const mean = Math.exp(big.amountPosterior.mu + big.amountPosterior.sigmaSq / 2);
    // 以前は、金額を全カテゴリの平均へ強く引き寄せ(事前の強さ10)、5,000円が3,000円台になっていた。
    expect(mean).toBeGreaterThan(4000);
    expect(mean).toBeLessThan(5500);
  });
});

describe('levelSigmaFor(支出の水準の不確かさ)', () => {
  it('記録が短いほど大きく、長いほど小さい。範囲に収まる', () => {
    expect(levelSigmaFor(10)).toBeGreaterThan(levelSigmaFor(30));
    expect(levelSigmaFor(30)).toBeGreaterThan(levelSigmaFor(365));
    expect(levelSigmaFor(1)).toBeLessThanOrEqual(0.6);
    expect(levelSigmaFor(100000)).toBeGreaterThanOrEqual(0.05);
  });
});

describe('休みの日(土日祝)の1回の金額', () => {
  const dates = eachDay('2026-06-01', '2026-09-28');
  const weekday = (d: string) => {
    const w = new Date(d).getUTCDay();
    return w !== 0 && w !== 6;
  };
  const build = (offYen: number): VariableTrainingData[] => [
    {
      categoryId: 'dining',
      categoryName: '外食',
      days: dates.map((date) => ({ date, count: 1, amountYen: weekday(date) ? 1000 : offYen })),
    },
  ];

  it('休みの日の金額が平日の2倍なら、差(対数、2倍はln2≒0.69)をおおむね見つける(縮めるので0.4以上)', () => {
    const [cat] = fitModel({ variable: build(2000), today: '2026-09-28', payday: null }).categories;
    expect(cat!.dayOffAmount.delta).toBeGreaterThan(0.4);
    expect(cat!.dayOffAmount.share).toBeGreaterThan(0.2);
    expect(cat!.dayOffAmount.share).toBeLessThan(0.5);
  });

  it('差が無ければ、差はほぼ0', () => {
    const [cat] = fitModel({ variable: build(1000), today: '2026-09-28', payday: null }).categories;
    expect(Math.abs(cat!.dayOffAmount.delta)).toBeLessThan(0.05);
  });

  it('休みの日の観測が少ないときは、差を小さく見る(信じすぎない)', () => {
    const few: VariableTrainingData[] = [
      {
        categoryId: 'dining',
        categoryName: '外食',
        days: dates.map((date) => ({
          date,
          count: weekday(date) || date === '2026-09-27' ? 1 : 0,
          amountYen: weekday(date) ? 1000 : date === '2026-09-27' ? 5000 : 0,
        })),
      },
    ];
    const [cat] = fitModel({ variable: few, today: '2026-09-28', payday: null }).categories;
    expect(cat!.dayOffAmount.delta).toBeLessThan(0.7);
  });
});
