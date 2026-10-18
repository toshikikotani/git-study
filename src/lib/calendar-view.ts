/**
 * 明細のカレンダーの表示(出す / 隠す、週 / 月)。本人要望(ADR-093 → 121):選んだほうを覚えておき、次に
 * 開いたときも同じにする。サーバーの描画でも同じ表示にするため cookie に置く(localStorage はサーバーから
 * 読めず、開くたびに一瞬切り替わって見える)。この端末だけの設定。
 */
export type CalendarView = 'week' | 'month';

export const CALENDAR_VIEW_COOKIE = 'spending-calendar-view';
export const CALENDAR_OPEN_COOKIE = 'spending-calendar-open';

/** 400日(ブラウザが受け付ける cookie の最長)。 */
export const CALENDAR_VIEW_MAX_AGE = 60 * 60 * 24 * 400;

export function parseCalendarView(value: string | null | undefined): CalendarView {
  return value === 'month' ? 'month' : 'week';
}

/** 既定は出す(本人の要望「カレンダーは表示したい」、ADR-121)。隠したとき('0')だけ隠す。 */
export function parseCalendarOpen(value: string | null | undefined): boolean {
  return value !== '0';
}
