import type { Route } from 'next';
import Link from 'next/link';

import { BackHeader } from '@/components/ui/back-header';
import { GenreBudgetRow } from '@/components/ui/genre-budget-row';
import { DailyReportCard } from './daily-report-view';
import {
  loadDailyAiReportView,
  loadMonthlyAiReportView,
  loadMonthlyReport,
} from '@/features/ai-report/store';
import { loadCalendarMonth } from '@/features/spending/store';
import { monthStartJst } from '@/lib/date';
import { monthReviewHref, resolveCalendarMonthStart } from '@/lib/period-nav';
import { withMinDuration } from '@/lib/min-loading-duration';
import { MonthlyReportCard, SavedMonthlyReportCard } from './report-view';

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
// 着地の見込み(確率予測)と、初回だけ過去の月での検証を含むため、余裕を持たせる。
export const maxDuration = 60;

export default async function AiReportPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string | string[] }>;
} = {}) {
  const now = new Date();
  const currentMonthStart = monthStartJst(0, now);
  const { month } = (await searchParams) ?? {};
  const monthStart = resolveCalendarMonthStart(month, currentMonthStart);
  const monthKey = monthStart.slice(0, 7);
  const isCurrentMonth = monthStart === currentMonthStart;
  const [dailyView, monthlyView, savedReport, ledger] = await withMinDuration(
    Promise.all([
      isCurrentMonth ? loadDailyAiReportView(now) : null,
      isCurrentMonth ? loadMonthlyAiReportView(now) : null,
      isCurrentMonth ? null : loadMonthlyReport(monthKey),
      loadCalendarMonth(monthStart, now),
    ]),
  );

  const maxYen = Math.max(...ledger.genreBreakdown.map((r) => r.spentYen), 1);

  return (
    <div className="rise space-y-3">
      <BackHeader
        back={{ href: monthReviewHref(monthKey), label: '月のふりかえり' }}
        title="AIレポート"
        sub={`${monthKey} の傾向・気づき・アドバイス`}
      />

      {dailyView !== null ? <DailyReportCard view={dailyView} /> : null}

      {monthlyView !== null ? (
        <MonthlyReportCard key={monthKey} view={monthlyView} />
      ) : (
        <>
          <SavedMonthlyReportCard monthKey={monthKey} report={savedReport} />
          <Link
            href={`/reports/ai?month=${currentMonthStart.slice(0, 7)}` as Route}
            className="flex min-h-11 items-center text-sm font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            今日・今月のレポートを表示・作成する
          </Link>
        </>
      )}

      {/* ジャンル別の内訳(家計簿と同じ集計・同じ行の部品) */}
      {ledger.genreBreakdown.length > 0 ? (
        <section
          aria-label="カテゴリ別の内訳"
          className="glass rounded-2xl p-4"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <h2 className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
            カテゴリ別の内訳
          </h2>
          <ul className="mt-2 space-y-1">
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
