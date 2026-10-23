/** 金額の書き方は Web 版と同じ関数(src/domain/money.ts、ADR-131)。 */
export { formatCompactYen, formatYen } from '@/domain/money';

/** 2026-10-21 → 10月21日 */
export function dateLabel(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}
