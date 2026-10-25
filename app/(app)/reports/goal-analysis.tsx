import { formatEstimate } from '@/domain/forecast/format';
import { remainingOfTotal } from '@/domain/forecast/remaining';
import { formatYen } from '@/domain/money';
import { periodDays } from '@/domain/period';
import { reportInsights } from '@/domain/report-insights';
import { loadMonthlyReport } from '@/features/ai-report/store';
import { buildCategoryLines, UNCATEGORIZED_KEY } from '@/features/category/model';
import { buildCumulative, linesForGoal } from '@/features/category/pace';
import { loadCategoryOutlooks } from '@/features/goals/category-outlook';
import { loadCategorySpendingTrend } from '@/features/reports/store';
import { watchToneOf } from '@/domain/forecast/watch-categories';
import type { SpendingPlan } from '@/features/spending-plan/store';
import { AiCard } from './ai-card';
import { GroupHeading } from './analysis-tabs';
import { CategoryProgress, type ProgressRow, type UntargetedRow } from './category-progress';
import { DetailRows } from './detail-rows';
import { GoalStatusCard } from './goal-status-card';
import { NextStepCard } from './next-step-card';
import { ProbabilityCard } from './probability-card';
import { SpendingTrendChart } from './spending-trend-chart';
import { WeekdayHabit } from './weekday-habit';
import { weekdayHabitRows } from './weekday-habit-data';
import { VerificationCard } from './verification-card';
import { WhyCard } from './why-card';

/** 2026-10-01 → 10/1 */
function md(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/** 2026-11-05 → 11月5日 */
function dayLabel(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

/** AIの分析の時刻:今日なら「今日 8:00 更新」、ほかの日は「10月14日 更新」。 */
function updatedLabel(createdAt: string, today: string): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(createdAt));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  return date === today
    ? `今日 ${Number(get('hour'))}:${get('minute')} 更新`
    : `${dayLabel(date)} 更新`;
}

const man = (yen: number) => formatEstimate(yen, { approx: false }).replace('円', '');

/**
 * 分析 › 目標(デザイン仕様書の「4a 分析 › 目標」、ADR-091。旧「見通し」をまとめた):
 * 1 いまの状況 → 2 どこで使っているか(進み具合・曜日のくせ)→ 3 ペース → 4 次にできること → 5 くわしく。
 * 数字はすべて目標の期間の1つの確率予測から出す(今日の「今期の見通し」・⑥・⑦と同じ数字)。
 */
export async function GoalAnalysis({ plan, today }: { plan: SpendingPlan; today: string }) {
  const period = { from: plan.periodStart, to: plan.periodEnd };
  const [loaded, report, trend] = await Promise.all([
    loadCategoryOutlooks({ plan, today }),
    loadMonthlyReport(today.slice(0, 7)).catch(() => null),
    loadCategorySpendingTrend().catch(() => null),
  ]);
  const forecast = loaded.forecast?.forecast ?? null;
  if (forecast === null || forecast.total.p50 <= 0) {
    return (
      <p className="px-1 text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
        {forecast === null
          ? '着地の見込みを計算できませんでした。しばらくしてからもう一度開いてください。'
          : '見込みを出すには、まだ記録が足りません。'}
      </p>
    );
  }

  const budgetYen = plan.items.reduce((sum, item) => sum + Math.max(0, item.targetYen), 0);
  const remainingDays = loaded.remainingDays;
  const fixedRows = loaded.rows.filter((row) => row.group === 'fixed');
  const fixedIds = new Set(fixedRows.map((row) => row.genreId));
  const fixedYen = fixedRows.reduce((sum, row) => sum + row.p50, 0);
  const closed = new Set(loaded.genres.filter((g) => g.forecastClosed).map((g) => g.id));

  // いまの状況のグラフ:期間の明細を、すべてのカテゴリで足し上げる。
  const txs = loaded.transactions.map((tx) => ({ ...tx, items: [] }));
  const keys = [
    ...new Set([
      ...loaded.genres.map((g) => g.id),
      ...loaded.transactions.flatMap((tx) => [tx.genreId, ...tx.splits.map((sp) => sp.genreId)]),
    ]),
  ].map((id) => id ?? UNCATEGORIZED_KEY);
  const days = buildCumulative({
    lines: linesForGoal(
      keys.flatMap((key) => buildCategoryLines(txs, key, period, today)),
      period,
    ),
    monthStart: period.from,
    monthEnd: period.to,
    today,
    recordStart: period.from,
    goal: { range: period, budgetYen },
    remaining: remainingOfTotal(forecast),
  }).days;
  let spentYen = 0;
  for (const d of days) if (d.actualYen !== null) spentYen = d.actualYen;

  // 目標なし(「期間中の支出から追加」で使った額がそのまま目標だったもの、ADR-108):見込みだけ出す。
  const untargeted: UntargetedRow[] = loaded.outlooks
    .filter((o) => o.untargeted)
    .map((o) => ({
      genreId: o.genreId,
      name: o.name,
      spentYen: o.spentYen,
      p50: o.p50,
      fixed: o.fixed,
    }));

  // どこで使っているか:目標のあるカテゴリの進み具合。「気をつけたい」は今日と同じ決め方(ADR-127):
  // こえた・こえそう・8割をこえた。固定費(決まった型・予測を止めたカテゴリ)は別にまとめる。
  const progress: ProgressRow[] = loaded.outlooks
    .filter((o) => o.targetYen !== null)
    .map((o) => {
      const fixed = o.fixed || fixedIds.has(o.genreId);
      const tone = watchToneOf({
        spentYen: o.spentYen,
        targetYen: o.targetYen,
        p50: o.p50,
        caution: o.caution,
        fixed,
      });
      return {
        genreId: o.genreId,
        name: o.name,
        spentYen: o.spentYen,
        targetYen: o.targetYen!,
        p50: o.p50,
        fixed,
        tone: fixed ? 'fixed' : (tone ?? 'ok'),
      };
    });
  const habit = weekdayHabitRows(loaded.transactions, {
    from: period.from,
    to: today < period.to ? today : period.to,
  });

  // ペース:1日ごとの支出(固定費をのぞく)。今日の分から固定費として除いた額と、その元(カテゴリ・記録)も
  // 数えておき、グラフの下に出す(今日の棒が明細の合計より小さい理由がわかるように、ADR-102)。
  const daySpend: Record<string, number> = {};
  let todayFixedYen = 0;
  const todayFixedNames = new Set<string>();
  for (const tx of loaded.transactions) {
    if (tx.occurredOn > today) continue;
    if (tx.amountYen >= 0 || tx.isTransfer || tx.reviewStatus === 'ignored' || tx.needsInput)
      continue;
    const fixedGenre = tx.genreId !== null && (closed.has(tx.genreId) || fixedIds.has(tx.genreId));
    if (tx.mustPay || fixedGenre) {
      if (tx.occurredOn === today) {
        todayFixedYen += -tx.amountYen;
        todayFixedNames.add(fixedGenre ? (tx.genreName ?? '未分類') : tx.label);
      }
      continue;
    }
    daySpend[tx.occurredOn] = (daySpend[tx.occurredOn] ?? 0) + -tx.amountYen;
  }
  const variableSpent = Object.entries(daySpend)
    .filter(([date]) => date >= period.from)
    .reduce((sum, [, yen]) => sum + yen, 0);
  const variableBudget = Math.max(0, budgetYen - fixedYen);
  const totalDays = Math.max(1, periodDays(plan.periodStart, plan.periodEnd));

  // 次にできること:AIの気づき(無ければ記録から決まる気づき)。
  const monthKey = today.slice(0, 7);
  const previousMonthKey = trend?.monthKeys.filter((key) => key < monthKey).at(-1);
  const previousByGenre =
    trend && previousMonthKey !== undefined
      ? new Map(
          trend.rows
            .filter((row) => row.monthKey === previousMonthKey)
            .map((row) => [row.categoryId, row.spentYen] as const),
        )
      : undefined;
  const bullets =
    report && report.insights.length > 0
      ? report.insights
      : reportInsights({
          forecast,
          budgetYen,
          periodLabel: '今期',
          ...(previousByGenre ? { previousByGenre, previousLabel: '先月' } : {}),
        }).map((insight) => insight.text);

  const b = forecast.breakdown;
  const decided = b.actualYen + b.committedYen;
  const ahead = Math.max(0, b.totalYen - decided);

  return (
    <>
      <GroupHeading>いまの状況</GroupHeading>
      <GoalStatusCard
        status={{
          budgetYen,
          p10: forecast.total.p10,
          p50: forecast.total.p50,
          p90: forecast.total.p90,
          probWithin: forecast.probWithinBudget,
          days,
          spentYen,
          provisional: forecast.provisional,
        }}
        periodLabel={`${md(period.from)}〜${md(period.to)} · 残り${remainingDays}日`}
        endLabel={dayLabel(period.to)}
        remainingDays={remainingDays}
      />

      <GroupHeading>どこで使っているか</GroupHeading>
      <CategoryProgress rows={progress} untargeted={untargeted} />
      <WeekdayHabit rows={habit} />

      {today >= period.from ? (
        <>
          <GroupHeading>ペース</GroupHeading>
          <SpendingTrendChart
            daySpend={daySpend}
            fixedYen={fixedYen}
            from={period.from}
            to={period.to}
            todayFixed={
              todayFixedYen > 0 ? { yen: todayFixedYen, names: [...todayFixedNames] } : null
            }
            budgetPerDayYen={variableBudget > 0 ? Math.round(variableBudget / totalDays) : null}
            remainingPerDayYen={
              variableBudget > 0 && remainingDays > 0
                ? Math.round(Math.max(0, variableBudget - variableSpent) / remainingDays)
                : null
            }
          />
        </>
      ) : null}

      <GroupHeading>次にできること</GroupHeading>
      {forecast.suggestion ? (
        <NextStepCard suggestion={forecast.suggestion} variant="goal" />
      ) : null}
      <AiCard
        asOfLabel={report ? updatedLabel(report.createdAt, today) : null}
        bullets={bullets}
        analyzed={report !== null}
      />

      <GroupHeading>くわしく</GroupHeading>
      <DetailRows
        rows={[
          {
            key: 'why',
            // 値は下の行に(右に並べると「なぜ約20.6万円？」が2行に折れた、本人の指摘、ADR-108)。
            title: 'なぜこの見込み？',
            sub: `${formatEstimate(b.totalYen)} = 決まった分 ${man(decided)} + これから ${man(ahead)}`,
            // 予測の確かさ(過去の月での当たり具合)もここで見る(もとは「そのほかの分析」、ADR-127)。
            content: (
              <div className="flex flex-col gap-3">
                <WhyCard forecast={forecast} closedGenreIds={closed} />
                <VerificationCard
                  verification={loaded.forecast?.verification ?? null}
                  monthStart={period.from}
                />
              </div>
            ),
          },
          ...(forecast.probWithinBudget !== null
            ? [
                {
                  key: 'probability',
                  title: '確率の分布',
                  value: `${man(forecast.total.p10)}〜${man(forecast.total.p90)}`,
                  content: (
                    <ProbabilityCard
                      distribution={forecast.distribution}
                      p50={forecast.total.p50}
                      budgetYen={budgetYen}
                      provisional={forecast.provisional}
                    />
                  ),
                },
              ]
            : []),
          ...(fixedRows.length > 0
            ? [
                {
                  key: 'fixed',
                  title: '固定費',
                  sub: '見込みに含めて計算',
                  value: formatYen(fixedYen, { sign: 'never' }),
                  content: (
                    <ul
                      className="flex flex-col rounded-2xl"
                      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
                    >
                      {fixedRows.map((row, i) => (
                        <li
                          key={row.genreId}
                          className="tabular flex min-h-12 items-center justify-between px-4 text-[16px]"
                          style={i > 0 ? { borderTop: '1px solid var(--hairline)' } : undefined}
                        >
                          <span>{row.name}</span>
                          <span>{formatYen(row.p50, { sign: 'never' })}</span>
                        </li>
                      ))}
                    </ul>
                  ),
                },
              ]
            : []),
        ]}
      />
    </>
  );
}
