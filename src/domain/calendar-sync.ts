/**
 * Google カレンダーへ同期する予定を組み立てる(本人発案)。
 *
 * ── なぜ作るか ──────────────────────────────────────────────
 * 給料日・サブスクの更新日・完済予定日は、このアプリの中でしか見えない
 * (毎回開かないと気づかない)。普段から開いているカレンダーに乗せておけば
 * 見落としが減る。
 *
 * ── ここが持つ責務 ──────────────────────────────────────────
 * 「何を・いつ登録するか」の業務判断だけを純粋関数として持つ。
 * `key` はまだ Google Calendar のイベントID(base32hex縛り)ではない、
 * 人間が読める識別子(features/google/calendar-store.ts がハッシュ化して
 * 実IDにする)。ここでは DB にも Google API にも触れない。
 *
 * ── key の設計(冪等性の要) ──────────────────────────────────
 * 給料日は「今月の給料日」「来月の給料日」がそれぞれ別の日付として実在する
 * ため、日付を key に含める(月ごとに1件ずつ増える。それが正しい)。
 * 一方サブスクの次回更新日・完済予定日は「1つの見込みを日々更新していく
 * 予報」であり、日付を key に含めてしまうと見込みが動くたびに新しい
 * イベントが作られ、古い予定がゴミとして残り続ける。そのためこの2つは
 * 日付を key に含めず、同じイベントの日付を毎回上書きする形にする。
 */

import { addMonths, nthDayOfMonth, type DateOnly } from '@/lib/date';
import { formatYen } from '@/domain/money';

export type PlannedCalendarEvent = {
  /** カレンダー側のイベントIDの元になる識別子(実IDへの変換は features 層)。 */
  key: string;
  title: string;
  /** 終日予定として登録する。 */
  date: DateOnly;
  description?: string;
};

/** 何ヶ月先まで給料日を登録しておくか。カレンダーは先の予定も見たいため。 */
const PAYDAY_MONTHS_AHEAD = 3;

/**
 * 給料日(今日以降、直近数ヶ月分)。月ごとに別イベントとして積む
 * (同じ「給料日」でも月が違えば別の出来事のため)。
 */
export function planPaydayEvents(payday: number, today: DateOnly): PlannedCalendarEvent[] {
  const events: PlannedCalendarEvent[] = [];
  for (let i = 0; i < PAYDAY_MONTHS_AHEAD; i += 1) {
    const date = nthDayOfMonth(addMonths(today, i), payday);
    if (date < today) continue;
    events.push({ key: `payday:${date}`, title: '給料日', date });
  }
  return events;
}

/**
 * サブスクの次回更新見込み日。`s.key`(店名+金額の正規化、domain/subscriptions.ts
 * と同じ識別子)だけを key にし、日付は含めない——見込みが動いても
 * 同じイベントの日付を上書きするだけにして、増殖させない。
 */
export function planSubscriptionEvents(
  subscriptions: readonly {
    key: string;
    label: string;
    amountYen: number;
    nextExpectedOn: DateOnly;
  }[],
): PlannedCalendarEvent[] {
  return subscriptions.map((s) => ({
    key: `subscription:${s.key}`,
    title: `${s.label}(${formatYen(s.amountYen, { sign: 'never' })})の更新日`,
    date: s.nextExpectedOn,
  }));
}

/**
 * 完済予定日。返済状況で日付が前後に動きうるため、こちらも key に
 * 日付を含めない(1つのイベントの日付を上書きし続ける)。
 */
export function planPayoffEvent(payoffOn: DateOnly | null): PlannedCalendarEvent[] {
  if (!payoffOn) return [];
  return [{ key: 'payoff', title: '完済予定日', date: payoffOn }];
}
