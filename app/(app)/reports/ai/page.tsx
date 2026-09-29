import { GenreBudgetRow } from '@/components/ui/genre-budget-row';
import { DailyReportCard } from './daily-report-view';
import { loadDailyAiReportView, loadMonthlyAiReportView } from '@/features/ai-report/store';
import { loadMonthlyLedger } from '@/features/spending/store';
import { withMinDuration } from '@/lib/min-loading-duration';
import { MonthlyReportCard } from './report-view';

/**
 * AI月次・日次レポート(本人発案「AI関連もっと増やしたい。もっと画期的な機能
 * ない?」「日次レポートと月次レポートどっちも出力できるように」、
 * ADR-031/ADR-032)。既存の /reports(集計グラフ中心)とは別に、AIが実データ
 * から気づき・アドバイスを文章で組み立てて見せる専用画面。
 *
 * 浪費傾向のタイプ判定(persona)は月次レポートだけが持つ(ADR-032:1日分の
 * データでは判定のノイズが大きいため)。
 *
 * ジャンル別の内訳は /spending と同じ集計・同じ行の部品(GenreBudgetRow)を使う
 * (見た目・判断ロジックを二重に持たない)。絞り込みは /spending 側で行う。
 */
export const dynamic = 'force-dynamic';

export default async function AiReportPage() {
  const [dailyView, monthlyView, ledger] = await withMinDuration(
    Promise.all([loadDailyAiReportView(), loadMonthlyAiReportView(), loadMonthlyLedger()]),
  );

  const maxYen = Math.max(...ledger.genreBreakdown.map((r) => r.spentYen), 1);

  return (
    <div className="rise space-y-3">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          AIレポート
        </h1>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {monthlyView.input.monthKey} の傾向・気づき・アドバイス
        </p>
      </header>

      <DailyReportCard view={dailyView} />

      <MonthlyReportCard view={monthlyView} />

      {/* ジャンル別の内訳(家計簿と同じ集計・同じ行の部品) */}
      {ledger.genreBreakdown.length > 0 ? (
        <section
          aria-label="ジャンル別の内訳"
          className="rounded-2xl p-4"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <h2 className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
            ジャンル別の内訳
          </h2>
          <ul className="mt-2 space-y-0.5">
            {ledger.genreBreakdown.map((r) => (
              <li key={r.genreId ?? 'none'}>
                <GenreBudgetRow
                  name={r.genreName}
                  spentYen={r.spentYen}
                  budgetYen={r.budgetYen}
                  maxYen={maxYen}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
