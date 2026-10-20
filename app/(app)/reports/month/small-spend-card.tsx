import { DetailSheet } from '@/components/ui/detail-sheet';
import { formatYen } from '@/domain/money';
import { loadAccumulationView } from '@/features/accumulation/store';
import { loadSpendingDiagnosisView } from '@/features/diagnosis/store';
import { loadMonthlyLedger } from '@/features/spending/store';
import { InsightsCard } from '../../spending/insights-card';
import { SmallSpendDetails } from './small-spend-details';

/**
 * 小口(ちりつも)のカード(提案書「分析を浅くする」、ADR-127)。今月の1,000円未満の支出と、そのペースが
 * 1年続いたときの額。「くわしく」で、店ごとの小口・支出なしの日・ペースと、AI家計診断をシートで出す
 * (もとは「ちりつも」と「そのほかの分析」の画面)。年の額はちりつもと同じ計算(1日あたりに均して365倍)。
 */
export async function SmallSpendCard() {
  const [view, diagnosis, ledger] = await Promise.all([
    loadAccumulationView().catch(() => null),
    loadSpendingDiagnosisView().catch(() => null),
    loadMonthlyLedger().catch(() => null),
  ]);
  if (view === null) return null;
  const yen = (v: number) => formatYen(v, { sign: 'never' });
  return (
    <section
      aria-labelledby="small-spend"
      className="flex flex-col gap-1 rounded-[22px] px-4 pt-4 pb-2"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="small-spend" className="text-[17px] font-semibold">
          小口(ちりつも)
        </h2>
        <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          今月・1回{yen(view.thresholdYen)}未満
        </span>
      </div>
      <p className="tabular text-[22px] font-bold">{yen(view.smallSpendTotalYen)}</p>
      <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        {view.smallSpendTotalYen > 0
          ? `このペースが1年続くと ${yen(view.smallSpendAnnualizedYen)}`
          : '今月はまだ小口の支出がありません。'}
      </p>
      <DetailSheet label="くわしく" title="小口(ちりつも)">
        <SmallSpendDetails view={view} />
        {diagnosis && ledger ? (
          <InsightsCard
            view={diagnosis}
            totalSpentYen={ledger.totals.spentYen}
            pile={{
              thresholdYen: view.thresholdYen,
              smallSpendTotalYen: view.smallSpendTotalYen,
              smallSpendAnnualizedYen: view.smallSpendAnnualizedYen,
            }}
          />
        ) : null}
      </DetailSheet>
    </section>
  );
}
