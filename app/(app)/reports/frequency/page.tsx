import { BackHeader } from '@/components/ui/back-header';
import { loadMonthlyLedger } from '@/features/spending/store';
import { BubbleChart } from '../bubble-chart';
import { frequencyPoints, frequencySummary } from '../frequency';

export const dynamic = 'force-dynamic';

/** 回数と1回の金額(分析から開く、ADR-090):今月のカテゴリごとの回数・1回の平均・合計。 */
export default async function FrequencyPage() {
  const ledger = await loadMonthlyLedger();
  const points = frequencyPoints(ledger.transactions);
  const summary = frequencySummary(points);
  return (
    <div className="rise flex flex-col gap-4">
      <BackHeader
        back={{ href: '/reports', label: '分析' }}
        title="回数と1回の金額"
        sub={`${Number(ledger.period.from.slice(5, 7))}月${summary ? ` · ${summary}` : ''}`}
      />
      <BubbleChart points={points} />
    </div>
  );
}
