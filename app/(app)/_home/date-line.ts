import { daysBetween, splitDateOnly, weekdayOf } from '@/lib/date';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 「10月8日 木曜日 · 残り24日」(残りは今日を含む、その月の日数) */
export function homeDateLine(today: string): string {
  const [year, month, day] = splitDateOnly(today);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEnd = `${today.slice(0, 8)}${String(lastDay).padStart(2, '0')}`;
  const left = daysBetween(today, monthEnd) + 1;
  return `${month}月${day}日 ${WEEKDAYS[weekdayOf(today)]}曜日 · 残り${left}日`;
}
