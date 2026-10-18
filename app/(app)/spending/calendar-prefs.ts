'use client';

import { useSyncExternalStore } from 'react';

import {
  CALENDAR_OPEN_COOKIE,
  CALENDAR_VIEW_COOKIE,
  CALENDAR_VIEW_MAX_AGE,
  parseCalendarOpen,
  parseCalendarView,
  type CalendarView,
} from '@/lib/calendar-view';

/**
 * 明細のカレンダーの表示(出す / 隠す、週 / 月)を cookie に覚えておく(ADR-093 → 121)。最初の描画は
 * サーバーが読んだ値、そのあとは端末の cookie を読む(画面を移ってルーターのキャッシュから戻っても、
 * 最後に選んだ表示になる)。cookie が使えない端末でも、開いているあいだは選んだ表示を保つ。
 */
function cookiePref<T extends string | boolean>(
  name: string,
  parse: (raw: string | undefined) => T,
  serialize: (value: T) => string,
) {
  const listeners = new Set<() => void>();
  let chosen: { value: T } | null = null;
  return {
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    read(): T {
      if (chosen !== null) return chosen.value;
      const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return parse(match?.[1]);
    },
    save(value: T): void {
      chosen = { value };
      document.cookie = `${name}=${serialize(value)}; path=/; max-age=${CALENDAR_VIEW_MAX_AGE}; samesite=lax`;
      for (const cb of listeners) cb();
    },
  };
}

const viewPref = cookiePref<CalendarView>(CALENDAR_VIEW_COOKIE, parseCalendarView, (v) => v);
const openPref = cookiePref<boolean>(CALENDAR_OPEN_COOKIE, parseCalendarOpen, (v) =>
  v ? '1' : '0',
);

/** 週 / 月。initial はサーバーで読んだ cookie の値。 */
export function useCalendarView(initial: CalendarView): CalendarView {
  return useSyncExternalStore(viewPref.subscribe, viewPref.read, () => initial);
}
export const saveCalendarView = viewPref.save;

/** 出す / 隠す。initial はサーバーで読んだ cookie の値。 */
export function useCalendarOpen(initial: boolean): boolean {
  return useSyncExternalStore(openPref.subscribe, openPref.read, () => initial);
}
export const saveCalendarOpen = openPref.save;
