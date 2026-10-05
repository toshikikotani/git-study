import { describe, expect, it } from 'vitest';

import { fitModel } from '@/domain/forecast/model';
import type { CategoryDayRecord, VariableTrainingData } from '@/domain/forecast/types';
import { eachDay } from '@/domain/period';

function buildDays(
  from: string,
  to: string,
  amountForDate: (date: string) => number,
): CategoryDayRecord[] {
  return eachDay(from, to).map((date) => {
    const amountYen = amountForDate(date);
    return { date, count: amountYen > 0 ? 1 : 0, amountYen };
  });
}

describe('fitModel(M2)', () => {
  it('毎日ちょうど1000円使うカテゴリは、回数の事後平均が1に近く、金額の事後中央値が1000円に近い', () => {
    const days = buildDays('2026-07-01', '2026-09-29', () => 1000);
    const variable: VariableTrainingData[] = [{ categoryId: 'a', categoryName: '外食', days }];
    const fitted = fitModel({ variable, today: '2026-09-29', payday: null });
    const cat = fitted.categories[0]!;
    const rateMean = cat.countPosterior.alpha / cat.countPosterior.beta;
    expect(rateMean).toBeGreaterThan(0.9);
    expect(rateMean).toBeLessThan(1.1);
    expect(Math.exp(cat.amountPosterior.mu)).toBeGreaterThan(900);
    expect(Math.exp(cat.amountPosterior.mu)).toBeLessThan(1100);
  });

  it('データが少ないカテゴリの曜日係数は1.0に近い(縮小推定)', () => {
    const days = buildDays('2026-09-25', '2026-09-29', (d) => (d === '2026-09-27' ? 5000 : 0));
    const variable: VariableTrainingData[] = [{ categoryId: 'a', categoryName: '外食', days }];
    const fitted = fitModel({ variable, today: '2026-09-29', payday: null });
    for (const f of fitted.categories[0]!.weekdayFactor) {
      expect(f).toBeGreaterThan(0.5);
      expect(f).toBeLessThan(2);
    }
  });

  it('データが十分にあれば、日曜だけ支出があるカテゴリの日曜係数は1より明確に大きい', () => {
    const days = buildDays('2026-04-01', '2026-09-29', (d) =>
      new Date(d).getUTCDay() === 0 ? 3000 : 0,
    );
    const variable: VariableTrainingData[] = [{ categoryId: 'a', categoryName: 'レジャー', days }];
    const fitted = fitModel({ variable, today: '2026-09-29', payday: null });
    const sunday = fitted.categories[0]!.weekdayFactor[0]!;
    const monday = fitted.categories[0]!.weekdayFactor[1]!;
    expect(sunday).toBeGreaterThan(monday);
    expect(sunday).toBeGreaterThan(1.5);
    expect(monday).toBeLessThan(1.2);
  });

  it('直近ほど重みが大きい(半減期30日):同じ回数でも直近に集中している方が推定回数が多くなる', () => {
    const recentHeavy = buildDays('2026-04-01', '2026-09-29', (d) =>
      d >= '2026-09-15' ? 2000 : 0,
    );
    const oldHeavy = buildDays('2026-04-01', '2026-09-29', (d) => (d <= '2026-04-15' ? 2000 : 0));
    const fittedRecent = fitModel({
      variable: [{ categoryId: 'a', categoryName: '外食', days: recentHeavy }],
      today: '2026-09-29',
      payday: null,
    });
    const fittedOld = fitModel({
      variable: [{ categoryId: 'a', categoryName: '外食', days: oldHeavy }],
      today: '2026-09-29',
      payday: null,
    });
    const recentRate =
      fittedRecent.categories[0]!.countPosterior.alpha /
      fittedRecent.categories[0]!.countPosterior.beta;
    const oldRate =
      fittedOld.categories[0]!.countPosterior.alpha / fittedOld.categories[0]!.countPosterior.beta;
    expect(recentRate).toBeGreaterThan(oldRate);
  });

  it('件数の少ないカテゴリの金額は、全カテゴリ平均へ縮小される', () => {
    const highSpendDays = buildDays('2026-07-01', '2026-09-29', () => 5000);
    const rareDays = buildDays('2026-07-01', '2026-09-29', (d) => (d === '2026-09-20' ? 300 : 0));
    const fitted = fitModel({
      variable: [
        { categoryId: 'a', categoryName: '外食', days: highSpendDays },
        { categoryId: 'b', categoryName: 'その他', days: rareDays },
      ],
      today: '2026-09-29',
      payday: null,
    });
    const rare = fitted.categories.find((c) => c.categoryId === 'b')!;
    // 300円1件だけなら素の対数平均は log(300) だが、全体平均(高額寄り)へ寄っているはず
    expect(Math.exp(rare.amountPosterior.mu)).toBeGreaterThan(400);
  });

  it('記録が一切無ければフォールバック値で破綻しない', () => {
    const fitted = fitModel({ variable: [], today: '2026-09-29', payday: null });
    expect(fitted.categories).toEqual([]);
    expect(fitted.pooledDailyRate).toBeGreaterThan(0);
    expect(Number.isFinite(fitted.pooledDailyRate)).toBe(true);
  });
});
