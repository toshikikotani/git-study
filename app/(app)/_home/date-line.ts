import { splitDateOnly, weekdayOf } from '@/lib/date';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 「10月16日 金曜日」(デザイン仕様書の「今日」の見出し、ADR-090) */
export function homeDateLine(today: string): string {
  const [, month, day] = splitDateOnly(today);
  return `${month}月${day}日 ${WEEKDAYS[weekdayOf(today)]}曜日`;
}
