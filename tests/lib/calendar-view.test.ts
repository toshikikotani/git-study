import { describe, expect, it } from 'vitest';

import { parseCalendarOpen, parseCalendarView } from '@/lib/calendar-view';

describe('明細のカレンダーの表示を覚えておく(ADR-093)', () => {
  it('cookie が month なら月、それ以外(無い・壊れた値)は既定の週', () => {
    expect(parseCalendarView('month')).toBe('month');
    expect(parseCalendarView('week')).toBe('week');
    expect(parseCalendarView(undefined)).toBe('week');
    expect(parseCalendarView(null)).toBe('week');
    expect(parseCalendarView('day')).toBe('week');
  });
});

describe('明細のカレンダーを出す / 隠すを覚えておく(ADR-121)', () => {
  it('既定は出す。隠したとき(0)だけ隠す', () => {
    expect(parseCalendarOpen(undefined)).toBe(true);
    expect(parseCalendarOpen(null)).toBe(true);
    expect(parseCalendarOpen('1')).toBe(true);
    expect(parseCalendarOpen('0')).toBe(false);
    expect(parseCalendarOpen('x')).toBe(true);
  });
});
