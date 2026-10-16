import { describe, expect, it } from 'vitest';

import { parseCalendarView } from '@/lib/calendar-view';

describe('明細のカレンダーの表示を覚えておく(ADR-093)', () => {
  it('cookie が month なら月、それ以外(無い・壊れた値)は既定の週', () => {
    expect(parseCalendarView('month')).toBe('month');
    expect(parseCalendarView('week')).toBe('week');
    expect(parseCalendarView(undefined)).toBe('week');
    expect(parseCalendarView(null)).toBe('week');
    expect(parseCalendarView('day')).toBe('week');
  });
});
