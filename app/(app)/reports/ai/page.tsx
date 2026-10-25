import type { Route } from 'next';
import Link from 'next/link';

import { BackHeader } from '@/components/ui/back-header';
import { loadReportPeriod, periodLabel } from '@/features/ai-report/period';
import {
  listMonthlyReportMonths,
  loadDailyAiReportView,
  loadMonthlyAiReportView,
  loadMonthlyReport,
} from '@/features/ai-report/store';
import { listPlanRanges } from '@/features/spending-plan/store';
import { backTargetOf } from '@/lib/back-target';
import { withMinDuration } from '@/lib/min-loading-duration';
import { monthReviewHref, resolveCalendarMonthStart } from '@/lib/period-nav';
import { DailyReportCard } from './daily-report-view';
import { MonthlyReportCard, SavedMonthlyReportCard } from './report-view';

/**
 * AIのレポート(ADR-031/032 → 127 → 128)。日次のレポート・浪費のタイプ診断とその理由・アドバイス・
 * 着地の見込みについてのAIの読み・前の月のレポートを、ここで見る。ADR-127 で分析の「AIの気づき」と
 * 今日の1行にまとめたが、本人の指摘(「どっかで見れるように戻して」)で、くわしい中身を見る画面として戻した。
 * 分析 › 目標の「AIの気づき」、月のふりかえり、今日の1行から開く。
 *
 * 浪費傾向のタイプ判定(persona)は月次レポートだけが持つ(ADR-032:1日分のデータでは判定のノイズが大きい)。
 * いまの期間以外は、その期間に保存したレポートの文章だけを出す(今の貯金・予測を混ぜない)。
 *
 * 期間は今期の目標の期間(無ければ暦の1か月、ADR-135)。レポートは期間の終わりの月で残すので、
 * ?month= はその月('YYYY-MM')。その月に終わる目標があれば、その期間の名前で出す。
 */
export const dynamic = 'force-dynamic';
// 着地の見込み(確率予測)と、初回だけ過去の月での検証を含むため、余裕を持たせる。
export const maxDuration = 60;

function jaMonth(monthKey: string): string {
  return `${Number(monthKey.slice(0, 4))}年${Number(monthKey.slice(5, 7))}月`;
}

export default async function AiReportPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string | string[]; from?: string | string[] }>;
} = {}) {
  const now = new Date();
  const [current, plans] = await Promise.all([
    loadReportPeriod(now),
    listPlanRanges().catch(() => []),
  ]);
  const currentKey = current.key;
  const { month, from } = (await searchParams) ?? {};
  // 何も指定が無ければ、いまの期間(今期の目標、無ければ今月)。
  const monthKey =
    month === undefined
      ? currentKey
      : resolveCalendarMonthStart(month, `${currentKey}-01`).slice(0, 7);
  const isCurrentMonth = monthKey === currentKey;
  /** その月に終わる目標があればその期間、無ければ「2026年10月」。 */
  const titleOf = (key: string) => {
    if (key === currentKey && current.goal !== null) return current.label;
    const plan = plans
      .filter((p) => p.periodEnd.slice(0, 7) === key)
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
    return plan ? periodLabel({ from: plan.periodStart, to: plan.periodEnd }) : jaMonth(key);
  };
  const [dailyView, monthlyView, savedReport, savedMonths] = await withMinDuration(
    Promise.all([
      isCurrentMonth ? loadDailyAiReportView(now) : null,
      isCurrentMonth ? loadMonthlyAiReportView(now) : null,
      isCurrentMonth ? null : loadMonthlyReport(monthKey),
      listMonthlyReportMonths().catch(() => [] as string[]),
    ]),
  );
  const fromQuery = typeof from === 'string' ? `&from=${encodeURIComponent(from)}` : '';
  const hrefOf = (key: string) => `/reports/ai?month=${key}${fromQuery}` as Route;
  const pastMonths = savedMonths.filter((key) => key !== currentKey && key !== monthKey);

  return (
    <div className="rise space-y-3">
      <BackHeader
        back={backTargetOf(from, { href: monthReviewHref(monthKey), label: '月のふりかえり' })}
        title="AIのレポート"
        sub={`${titleOf(monthKey)}の傾向・気づき・アドバイス`}
      />

      {dailyView !== null ? <DailyReportCard view={dailyView} /> : null}

      {monthlyView !== null ? (
        <MonthlyReportCard key={monthKey} view={monthlyView} />
      ) : (
        <>
          <SavedMonthlyReportCard
            monthKey={monthKey}
            title={titleOf(monthKey)}
            report={savedReport}
          />
          <Link
            href={hrefOf(currentKey)}
            className="flex min-h-11 items-center text-sm font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            今日・いまの期間のレポートを見る・作る
          </Link>
        </>
      )}

      <section aria-labelledby="past-reports" className="space-y-2 pt-2">
        <h2
          id="past-reports"
          className="px-1 text-[15px] font-semibold"
          style={{ color: 'var(--ink-muted)' }}
        >
          前のレポート
        </h2>
        {pastMonths.length === 0 ? (
          <p className="px-1 text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {savedMonths.length === 0
              ? '保存したレポートはまだありません。いまの期間のレポートを作ると、期間ごとに残ります。'
              : 'ほかの期間に保存したレポートはありません。'}
          </p>
        ) : (
          <ul
            className="overflow-hidden rounded-2xl"
            style={{ background: 'var(--surface)', color: 'var(--ink)' }}
          >
            {pastMonths.map((key, i) => (
              <li key={key} style={i > 0 ? { borderTop: '1px solid var(--hairline)' } : undefined}>
                <Link
                  href={hrefOf(key)}
                  className="flex min-h-11 items-center justify-between gap-3 px-4 py-3 text-[15px]"
                >
                  {titleOf(key)}のレポート
                  <span aria-hidden style={{ color: 'var(--ink-muted)' }}>
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
