/**
 * 明細のカレンダーの表示(週 / 月)。本人要望(ADR-093):選んだほうを覚えておき、次に開いたときも同じにする。
 * サーバーの描画でも同じ表示にするため cookie に置く(localStorage はサーバーから読めず、開くたびに
 * 週から月へ一瞬切り替わって見える)。この端末だけの設定。
 */
export type CalendarView = 'week' | 'month';

export const CALENDAR_VIEW_COOKIE = 'spending-calendar-view';

/** 400日(ブラウザが受け付ける cookie の最長)。 */
export const CALENDAR_VIEW_MAX_AGE = 60 * 60 * 24 * 400;

export function parseCalendarView(value: string | null | undefined): CalendarView {
  return value === 'month' ? 'month' : 'week';
}
