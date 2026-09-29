import { describe, expect, it } from 'vitest';

import { heatLevel, monthGrid, weekOf } from '@/features/spending/heatmap';

describe('heatmap', () => {
  it('週は日曜始まりの7日', () => {
    // 2026-09-29 は火曜日
    expect(weekOf('2026-09-29')).toEqual([
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
  });

  it('月のマスは前後の月の日で埋めた完全な週の並び', () => {
    const grid = monthGrid('2026-09');
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid[0]![0]).toBe('2026-08-30');
    expect(grid.flat()).toContain('2026-09-30');
    expect(grid.at(-1)!.at(-1)! >= '2026-09-30').toBe(true);
  });

  it('金額の大きさを 0〜4 の濃さにする', () => {
    expect(heatLevel(0, 1000)).toBe(0);
    expect(heatLevel(100, 1000)).toBe(1);
    expect(heatLevel(400, 1000)).toBe(2);
    expect(heatLevel(600, 1000)).toBe(3);
    expect(heatLevel(1000, 1000)).toBe(4);
  });
});
