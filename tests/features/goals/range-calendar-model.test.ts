import { describe, expect, it } from 'vitest';

import { bandInWeek, monthsToShow, weekRows } from '@/features/goals/range-calendar-model';

describe('期間選択カレンダーのマス割り', () => {
  it('期間が月をまたぐときは、該当する月を縦に並べる', () => {
    expect(monthsToShow('2026-09-29', '2026-10-06', '2026-09-29')).toEqual([
      '2026-09-01',
      '2026-10-01',
    ]);
    expect(monthsToShow('2026-09-28', '2026-11-03', '2026-09-29')).toEqual([
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
    ]);
  });

  it('期間が1か月に収まる/未選択でも、翌月を選べるように2か月出す', () => {
    expect(monthsToShow('2026-09-01', '2026-09-20', '2026-09-01')).toHaveLength(2);
    expect(monthsToShow(null, null, '2026-09-29')).toEqual(['2026-09-01', '2026-10-01']);
    expect(monthsToShow(null, null, '2026-09-29', 1)).toHaveLength(3);
  });

  it('週の並びは日曜始まりで、月外のマスは空', () => {
    const rows = weekRows('2026-09-01'); // 9/1 は火曜
    expect(rows[0]!.slice(0, 2)).toEqual([null, null]);
    expect(rows[0]![2]).toBe('2026-09-01');
    expect(rows.every((r) => r.length === 7)).toBe(true);
  });

  it('週ごとの帯が期間をすき間なくつなぐ(9/29〜10/6 が月をまたぐ)', () => {
    const start = '2026-09-29';
    const end = '2026-10-06';
    const covered = new Set<string>();
    for (const m of ['2026-09-01', '2026-10-01']) {
      for (const week of weekRows(m)) {
        const band = bandInWeek(week, start, end);
        if (band === null) continue;
        // 帯の中に、期間外や月外のすき間が無い
        for (let i = band.from; i <= band.to; i += 1) {
          expect(week[i]).not.toBeNull();
          covered.add(week[i]!);
        }
      }
    }
    expect([...covered].sort()).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
    ]);
  });
});
