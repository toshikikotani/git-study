/**
 * Google カレンダー API のクライアント(本人発案)。
 *
 * 「何を登録するか」の業務判断は features/google/calendar-store.ts が持つ。
 * ここは Calendar API を叩くだけ(lib/discord.ts と同じ役割分担)。
 */

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

export class GoogleCalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleCalendarError';
  }
}

export type CalendarEventInput = {
  /** Calendar のイベントID(base32hex: 小文字 a-v と数字、5〜1024文字)。 */
  id: string;
  title: string;
  /** 終日予定として登録する(YYYY-MM-DD)。 */
  date: string;
};

/**
 * 終日予定を1件、無ければ作り・あれば日付と件名を上書きする。
 *
 * Calendar API に upsert 相当の単発 API が無いため、insert を試して
 * 409(既に存在)なら update に切り替える2手で冪等にする。
 */
export async function upsertCalendarEvent(
  accessToken: string,
  calendarId: string,
  event: CalendarEventInput,
): Promise<void> {
  const body = {
    id: event.id,
    summary: event.title,
    start: { date: event.date },
    end: { date: event.date },
  };

  const insertRes = await calendarFetch(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (insertRes.ok) return;
  if (insertRes.status !== 409) {
    throw new GoogleCalendarError(await describeError(insertRes));
  }

  const updateRes = await calendarFetch(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}`,
    { method: 'PUT', body: JSON.stringify(body) },
  );
  if (!updateRes.ok) {
    throw new GoogleCalendarError(await describeError(updateRes));
  }
}

function calendarFetch(accessToken: string, path: string, init: RequestInit): Promise<Response> {
  return fetch(`${CALENDAR_API_BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
  });
}

async function describeError(response: Response): Promise<string> {
  const detail = await response.text().catch(() => '');
  return `Google カレンダーへの書き込みに失敗しました(ステータス ${response.status}): ${detail}`;
}
