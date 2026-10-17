import { BackHeader } from '@/components/ui/back-header';
import { loadCalendarMonth } from '@/features/spending/store';
import { monthStartJst } from '@/lib/date';
import { monthReviewHref, resolveCalendarMonthStart } from '@/lib/period-nav';
import { BubbleChart } from '../bubble-chart';
import { frequencyPoints, frequencySummary } from '../frequency';

export const dynamic = 'force-dynamic';

/** 回数と1回の金額(分析から開く、ADR-090):選択月のカテゴリごとの回数・1回の平均・合計。 */
export default async function FrequencyPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string | string[] }>;
} = {}) {
  const now = new Date();
  const { month } = (await searchParams) ?? {};
  const monthStart = resolveCalendarMonthStart(month, monthStartJst(0, now));
  const ledger = await loadCalendarMonth(monthStart, now);
  const points = frequencyPoints(ledger.transactions);
  const summary = frequencySummary(points);
  return (
    <div className="rise flex flex-col gap-4">
      <BackHeader
        back={{ href: monthReviewHref(monthStart), label: '月のふりかえり' }}
        title="回数と1回の金額"
        sub={`${monthStart.slice(0, 4)}年${Number(monthStart.slice(5, 7))}月${summary ? ` · ${summary}` : ''}`}
      />
      <BubbleChart points={points} />
    </div>
  );
}
