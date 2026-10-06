/**
 * Google カレンダー同期のオーケストレーション(本人発案)。
 *
 * 「何を登録するか」は domain/calendar-sync.ts の純粋関数が決める。
 * ここは「DB から何を集めるか」「決定的なイベントIDへどう変換するか」
 * 「Calendar API をどう呼ぶか」を担う(features/alerts/store.ts と
 * 同じ store 層の役割分担)。
 */

import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  planPaydayEvents,
  planPayoffEvent,
  planSubscriptionEvents,
  type PlannedCalendarEvent,
} from '@/domain/calendar-sync';
import { getAppSettingsAsAdmin } from '@/features/settings/store';
import { loadHomeSummaryAsAdmin } from '@/features/home/summary';
import { loadDetectedSubscriptionsAsAdmin } from '@/features/subscriptions/store';
import type { GoogleEnv } from '@/lib/env';
import { todayJst } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { refreshGoogleAccessToken } from '@/lib/google-auth';
import { upsertCalendarEvent } from '@/lib/google-calendar';
import type { Database } from '@/lib/supabase/types';

export class GoogleCalendarSyncError extends AppError {}

/**
 * `key`(人間が読める識別子)を Calendar のイベントID(base32hex:
 * 小文字 a-v と数字、5〜1024文字)へ変換する。sha1 の16進ダイジェストは
 * 0-9a-f のみで構成され、そのまま条件を満たす(hex は base32hex の部分
 * 集合)。同じ key からは常に同じ id になる(冪等性の要)。
 */
export function toCalendarEventId(key: string): string {
  return createHash('sha1').update(key).digest('hex');
}

export type SyncCalendarResult = { syncedCount: number };

/**
 * 給料日・サブスク更新日・完済予定日を Google カレンダーへ同期する
 * (cron 向け、管理クライアント版)。1件ずつ upsert するため、途中で
 * 失敗しても、それ以前に同期できた分はカレンダーに残る。
 */
export async function syncCalendarAsAdmin(
  client: SupabaseClient<Database>,
  userId: string,
  google: GoogleEnv,
  now: Date = new Date(),
): Promise<SyncCalendarResult> {
  const today = todayJst(now);

  const [settings, summary, subscriptions] = await Promise.all([
    getAppSettingsAsAdmin(client, userId),
    loadHomeSummaryAsAdmin(client, userId, now),
    loadDetectedSubscriptionsAsAdmin(client, userId, now),
  ]);

  const events: PlannedCalendarEvent[] = [
    ...planPaydayEvents(settings.payday, today),
    ...planSubscriptionEvents(subscriptions),
    ...planPayoffEvent(summary.payoff.payoffOn),
  ];

  const accessToken = await refreshGoogleAccessToken(
    google.GOOGLE_CLIENT_ID,
    google.GOOGLE_CLIENT_SECRET,
    google.GOOGLE_REFRESH_TOKEN,
  );

  let syncedCount = 0;
  for (const event of events) {
    await upsertCalendarEvent(accessToken, 'primary', {
      id: toCalendarEventId(event.key),
      title: event.title,
      date: event.date,
    });
    syncedCount += 1;
  }

  return { syncedCount };
}
