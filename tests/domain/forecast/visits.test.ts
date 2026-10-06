import { describe, expect, it } from 'vitest';

import { detectRegularMerchants, projectVisits } from '@/domain/forecast/visits';
import { addDays } from '@/lib/date';

const visit = (key: string, occurredOn: string, amountYen = 4000) => ({
  key,
  label: key,
  categoryId: 'food',
  categoryName: '食料品',
  occurredOn,
  amountYen,
});

/** 2026-08-01 から every 日おきに n 回。 */
function every(key: string, everyDays: number, n: number, start = '2026-08-01') {
  return Array.from({ length: n }, (_, i) => visit(key, addDays(start, i * everyDays)));
}

describe('detectRegularMerchants(規則的に通う店)', () => {
  it('毎週通う店を、7日おきとして検出する', () => {
    const [m] = detectRegularMerchants(every('スーパー', 7, 8));
    expect(m).toMatchObject({ key: 'スーパー', everyDays: 7, visitCount: 8 });
    expect(m!.probability).toBeGreaterThan(0.85);
    expect(m!.categoryId).toBe('food');
  });

  it('毎日通う店(間隔1日)は対象にしない', () => {
    expect(detectRegularMerchants(every('コンビニ', 1, 20))).toEqual([]);
  });

  it('回数が少ない店・間隔がばらばらの店は対象にしない', () => {
    expect(detectRegularMerchants(every('たまに', 7, 3))).toEqual([]);
    const irregular = [
      '2026-08-01',
      '2026-08-03',
      '2026-08-20',
      '2026-08-22',
      '2026-09-15',
      '2026-09-30',
    ];
    expect(detectRegularMerchants(irregular.map((d) => visit('ばらばら', d)))).toEqual([]);
  });

  it('同じ日の複数の明細は1回の来店にまとめる', () => {
    const txs = [...every('スーパー', 7, 6), visit('スーパー', '2026-08-01', 500)];
    const [m] = detectRegularMerchants(txs);
    expect(m!.visitCount).toBe(6);
  });
});

describe('projectVisits(残り期間の来店の見込み)', () => {
  const [merchant] = detectRegularMerchants(every('スーパー', 7, 8)); // 最後の来店は 2026-09-19
  const base = {
    merchants: [merchant!],
    periodTo: '2026-10-31',
    scheduled: [] as { key: string; date: string }[],
  };

  it('次回は最後の来店+間隔。期間の終わりまで間隔ごとに並べる', () => {
    const dates = projectVisits({ ...base, today: '2026-09-20' }).map((e) => e.date);
    expect(dates[0]).toBe('2026-09-26');
    expect(dates[1]).toBe('2026-10-03');
    expect(dates.at(-1)).toBe('2026-10-31');
  });

  it('予定の日を過ぎていても間隔1回ぶん以内なら、明日に確率半分で置き、その後は明日から間隔ごと', () => {
    const events = projectVisits({ ...base, today: '2026-09-28' });
    expect(events[0]!.date).toBe('2026-09-29');
    expect(events[0]!.probability).toBeCloseTo(merchant!.probability / 2);
    expect(events[1]!.date).toBe('2026-10-06');
    expect(events[1]!.probability).toBeCloseTo(merchant!.probability);
  });

  it('大きく過ぎていれば周期が崩れたとみなして、間隔の倍数ぶん先へ送る', () => {
    const dates = projectVisits({ ...base, today: '2026-10-04' }).map((e) => e.date);
    expect(dates[0]).toBe('2026-10-10');
  });

  it('同じ店の予定が前後1日にある来店は数えない', () => {
    const events = projectVisits({
      ...base,
      today: '2026-09-20',
      scheduled: [{ key: 'スーパー', date: '2026-09-27' }],
    });
    expect(events.map((e) => e.date)).not.toContain('2026-09-26');
    expect(events.map((e) => e.date)).toContain('2026-10-03');
  });
});
