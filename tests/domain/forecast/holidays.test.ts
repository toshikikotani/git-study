import { describe, expect, it } from 'vitest';

import { isDayOff, isHoliday } from '@/domain/forecast/holidays';

describe('isHoliday(日本の祝日)', () => {
  it('固定日の祝日', () => {
    for (const d of [
      '2026-01-01',
      '2026-02-11',
      '2026-02-23',
      '2026-04-29',
      '2026-11-03',
      '2026-11-23',
    ]) {
      expect(isHoliday(d), d).toBe(true);
    }
  });

  it('ハッピーマンデー(2026年)', () => {
    expect(isHoliday('2026-01-12')).toBe(true); // 成人の日
    expect(isHoliday('2026-07-20')).toBe(true); // 海の日
    expect(isHoliday('2026-09-21')).toBe(true); // 敬老の日
    expect(isHoliday('2026-10-12')).toBe(true); // スポーツの日
    expect(isHoliday('2026-01-19')).toBe(false);
  });

  it('春分・秋分', () => {
    expect(isHoliday('2026-03-20')).toBe(true);
    expect(isHoliday('2026-09-23')).toBe(true);
    expect(isHoliday('2027-03-21')).toBe(true);
    expect(isHoliday('2027-09-23')).toBe(true);
  });

  it('振替休日:日曜の祝日の次の平日(2026-05-03 は日曜)', () => {
    expect(isHoliday('2026-05-06')).toBe(true);
    expect(isHoliday('2026-05-07')).toBe(false);
  });

  it('国民の休日:祝日にはさまれた平日(2026-09-22)', () => {
    expect(isHoliday('2026-09-22')).toBe(true);
  });

  it('ふつうの平日は祝日ではない', () => {
    expect(isHoliday('2026-10-06')).toBe(false);
    expect(isHoliday('2026-06-15')).toBe(false);
  });

  it('isDayOff は土日と祝日', () => {
    expect(isDayOff('2026-10-03')).toBe(true); // 土
    expect(isDayOff('2026-10-04')).toBe(true); // 日
    expect(isDayOff('2026-10-12')).toBe(true); // 祝
    expect(isDayOff('2026-10-06')).toBe(false); // 火
  });
});
