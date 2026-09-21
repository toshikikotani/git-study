import { CategoryBreakdownChart } from '../../spending/category-breakdown-chart';
import { loadMonthlyAiReportView } from '@/features/ai-report/store';
import { loadMonthlyLedger } from '@/features/spending/store';
import { withMinDuration } from '@/lib/min-loading-duration';
import { MonthlyReportCard } from './report-view';

/**
 * AI月次レポート(本人発案「AI関連もっと増やしたい。もっと画期的な機能ない?」、
 * ADR-031)。既存の /reports(集計グラフ中心)とは別に、AIが実データから
 * 浪費傾向のタイプ・気づき・アドバイスを文章で組み立てて見せる専用画面。
 *
 * カテゴリ別の内訳は /spending と同じ CategoryBreakdownChart をそのまま
 * 再利用する(見た目・判断ロジックを二重に持たない)。
 */
export const dynamic = 'force-dynamic';

export default async function AiReportPage() {
  const [view, ledger] = await withMinDuration(
    Promise.all([loadMonthlyAiReportView(), loadMonthlyLedger()]),
  );

  return (
    <div className="rise space-y-3">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          AI月次レポート
        </h1>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {view.input.monthKey} の傾向・気づき・アドバイス
        </p>
      </header>

      <MonthlyReportCard view={view} />

      <CategoryBreakdownChart rows={ledger.categoryBreakdown} />
    </div>
  );
}
