import { addMonths, type DateOnly } from '@/lib/date';

/** 期間の選択肢:今月から遡った12か月(新しい月が先頭)。 */
export function monthChoices(todayMonthKey: string, count = 12): { key: string; label: string }[] {
  const start = `${todayMonthKey}-01` as DateOnly;
  return Array.from({ length: count }, (_, i) => {
    const key = addMonths(start, -i).slice(0, 7);
    return { key, label: `${key.slice(0, 4)}年${Number(key.slice(5, 7))}月` };
  });
}
