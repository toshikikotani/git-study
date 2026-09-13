import { describe, expect, it } from 'vitest';

import { toCalendarEventId } from '@/features/google/calendar-store';

/**
 * Google Calendar のイベントIDへの変換(本人発案)。
 * 実際の Calendar API 呼び出しは lib/google-calendar.ts の責務(モックで
 * しか検証できないため、実際の API 疎通は本人の OAuth 接続後に確認する)。
 * ここでは「安全な文字集合に収まるか」「決定的か」だけを検証する。
 */
describe('toCalendarEventId', () => {
  it('base32hex(小文字 a-v・数字)だけで構成される', () => {
    const id = toCalendarEventId('payday:2026-10-25');
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
  });

  it('同じ key からは常に同じ id になる(冪等性の要)', () => {
    expect(toCalendarEventId('payoff')).toBe(toCalendarEventId('payoff'));
  });

  it('key が違えば id も変わる', () => {
    expect(toCalendarEventId('payoff')).not.toBe(toCalendarEventId('payday:2026-10-25'));
  });
});
