import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  addMonthsToParts,
  assertDateOnly,
  daysBetween,
  formatDateJa,
  monthStartJst,
  splitDateOnly,
  todayJst,
} from '@/lib/date';

describe('todayJst(ADR-015)', () => {
  it('UTC の日付ではなく JST の日付を返す', () => {
    // 2026-09-07T16:00:00Z は JST では 2026-09-08 01:00
    expect(todayJst(new Date('2026-09-07T16:00:00Z'))).toBe('2026-09-08');
  });

  it('JST の深夜の取引が前日に落ちない', () => {
    // 2026-09-08T14:59:59Z = JST 2026-09-08 23:59:59
    expect(todayJst(new Date('2026-09-08T14:59:59Z'))).toBe('2026-09-08');
    // 2026-09-08T15:00:00Z = JST 2026-09-09 00:00:00
    expect(todayJst(new Date('2026-09-08T15:00:00Z'))).toBe('2026-09-09');
  });

  it('年をまたぐ境界', () => {
    expect(todayJst(new Date('2025-12-31T15:00:00Z'))).toBe('2026-01-01');
  });
});

describe('monthStartJst', () => {
  const now = new Date('2026-09-08T00:00:00Z');

  it('当月の初日', () => {
    expect(monthStartJst(0, now)).toBe('2026-09-01');
  });

  it('翌月・前月', () => {
    expect(monthStartJst(1, now)).toBe('2026-10-01');
    expect(monthStartJst(-1, now)).toBe('2026-08-01');
  });

  it('年をまたぐ', () => {
    expect(monthStartJst(4, now)).toBe('2027-01-01');
    expect(monthStartJst(-9, now)).toBe('2025-12-01');
  });
});

describe('addMonthsToParts', () => {
  it('月末差異を吸収する(31日 → 2月は28日)', () => {
    expect(addMonthsToParts(2026, 1, 31, 1)).toBe('2026-02-28');
  });

  it('閏年の2月は29日', () => {
    expect(addMonthsToParts(2028, 1, 31, 1)).toBe('2028-02-29');
  });

  it('年をまたいで加算・減算できる', () => {
    expect(addMonthsToParts(2026, 12, 15, 1)).toBe('2027-01-15');
    expect(addMonthsToParts(2026, 1, 15, -1)).toBe('2025-12-15');
  });
});

describe('addMonths / addDays', () => {
  it('月を足す', () => {
    expect(addMonths('2026-09-08', 3)).toBe('2026-12-08');
  });

  it('日を足す・引く', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('daysBetween', () => {
  it('完済まで残り日数を数える(FR-03)', () => {
    expect(daysBetween('2026-09-08', '2027-08-27')).toBe(353);
  });

  it('過去なら負', () => {
    expect(daysBetween('2026-09-08', '2026-09-01')).toBe(-7);
  });

  it('同日は0', () => {
    expect(daysBetween('2026-09-08', '2026-09-08')).toBe(0);
  });
});

describe('assertDateOnly / splitDateOnly', () => {
  it('YYYY-MM-DD 以外を拒否する', () => {
    expect(() => assertDateOnly('2026/09/08')).toThrow(/YYYY-MM-DD/);
    expect(() => assertDateOnly('2026-9-8')).toThrow(/YYYY-MM-DD/);
  });

  it('分解できる', () => {
    expect(splitDateOnly('2026-09-08')).toEqual([2026, 9, 8]);
  });
});

describe('formatDateJa', () => {
  it('日本語表記にする', () => {
    expect(formatDateJa('2026-09-08')).toBe('2026年9月8日');
  });
});
