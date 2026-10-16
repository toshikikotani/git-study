/**
 * カテゴリごとの今期の様子(デザイン仕様書の「カテゴリ」⑦・「分析 › 目標」の進み具合・「今期の目標」⑥、ADR-091)。
 * 目標の期間(目標が無ければ今月)の1つの確率予測から、カテゴリごとの使った額・予定・見込み・
 * 見直し候補・グラフの材料を作る。3つの画面が同じ数字を出すよう、ここ1か所で組み立てる。
 */

import { landingRowsFrom, type LandingRow } from '@/domain/forecast/landing-rows';
import { remainingOfCategory } from '@/domain/forecast/remaining';
import { planPeriodDays } from '@/domain/spending-plan';
import { buildCategoryLines } from '@/features/category/model';
import { buildCumulative, linesForGoal, type CumulativeDay } from '@/features/category/pace';
import { goalForecastArgs } from '@/features/forecast/goal';
import { loadForecast } from '@/features/forecast/load';
import { listGenres, type Genre } from '@/features/genre/store';
import { loadCategorySpendingTrend } from '@/features/reports/store';
import type { SpendingPlan } from '@/features/spending-plan/store';
import { loadLedgerTransactions } from '@/features/spending/entries';
import type { LedgerTransaction } from '@/features/spending/ledger-types';
import { addDays, addMonths, daysBetween, monthStartJst, type DateOnly } from '@/lib/date';

export type CategoryOutlook = {
  genreId: string;
  name: string;
  /** 今期の目標額。目標に入っていなければ null。 */
  targetYen: number | null;
  /** 期間のはじめから今日までに使った額。 */
  spentYen: number;
  /** 今日より先の予定(使った額には入らない)。 */
  scheduledYen: number;
  lastMonthYen: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  /** 見直し候補(このままだと目標をこえそう)。probability はこえる確率。 */
  caution: { probability: number } | null;
  /** 固定費(予測を止めたカテゴリ)。 */
  fixed: boolean;
  /** 今期の目標の行の2行目(「先月より大きく増えそう」「いまのペース 1日 約127円」など)。 */
  sub: string | null;
  /** 見通しのグラフ(実績・予測の帯)。 */
  days: CumulativeDay[];
};

export type CategoryOutlooks = {
  period: { from: DateOnly; to: DateOnly };
  /** 今日を含む残りの日数。 */
  remainingDays: number;
  /** 期間の確率予測。出せなければ null。 */
  forecast: Awaited<ReturnType<typeof loadForecast>> | null;
  rows: LandingRow[];
  genres: Genre[];
  /** 期間(と勢いのための21日前から)の明細。 */
  transactions: LedgerTransaction[];
  outlooks: CategoryOutlook[];
};

/** 勢い(直近21日の平均)のために、期間のはじめより前から読む日数。 */
const LOOKBACK_DAYS = 21;

export async function loadCategoryOutlooks(input: {
  plan: SpendingPlan | null;
  today: DateOnly;
  /** 出すカテゴリ。省くと目標のカテゴリすべて(目標が無ければすべてのカテゴリ)。 */
  genreIds?: readonly string[];
}): Promise<CategoryOutlooks> {
  const { plan, today } = input;
  const monthFrom = monthStartJst();
  const period = plan
    ? { from: plan.periodStart, to: plan.periodEnd }
    : { from: monthFrom, to: addDays(addMonths(monthFrom, 1), -1) };
  const goal = goalForecastArgs(plan);
  const [loaded, genres, trend, ledger] = await Promise.all([
    loadForecast(goal ?? { period }).catch(() => null),
    listGenres().catch(() => []),
    loadCategorySpendingTrend().catch(() => null),
    loadLedgerTransactions(
      { from: addDays(period.from, -LOOKBACK_DAYS), to: period.to },
      today,
    ).catch(() => null),
  ]);
  const forecast = loaded?.forecast ?? null;
  const closed = new Set(genres.filter((g) => g.forecastClosed).map((g) => g.id));
  const rows = forecast
    ? landingRowsFrom({
        forecast,
        excludedByCategory: loaded?.excludedByCategory ?? new Map(),
        closedGenreIds: closed,
        cautionPrecision: loaded?.cautionPrecision ?? null,
        limit: Number.MAX_SAFE_INTEGER,
      })
    : [];
  const rowById = new Map(rows.map((row) => [row.genreId, row]));

  const monthKey = today.slice(0, 7);
  const previousMonthKey = trend?.monthKeys.filter((key) => key < monthKey).at(-1);
  const lastMonth = new Map(
    (trend?.rows ?? [])
      .filter((row) => row.monthKey === previousMonthKey)
      .map((row) => [row.categoryId, row.spentYen] as const),
  );

  const started = today >= period.from;
  const elapsedDays = started ? Math.max(1, daysBetween(period.from, today) + 1) : 1;
  const remainingDays = started
    ? Math.max(0, daysBetween(today, period.to) + 1)
    : planPeriodDays(period.from, period.to);
  const transactions = ledger?.transactions ?? [];
  const txs = transactions.map((tx) => ({ ...tx, items: [] }));
  const targets = new Map((plan?.items ?? []).map((item) => [item.genreId, item]));
  const nameById = new Map(genres.map((g) => [g.id, g.name]));
  const ids =
    input.genreIds ??
    (plan ? plan.items.map((item) => item.genreId) : genres.map((genre) => genre.id));

  const outlooks: CategoryOutlook[] = ids.map((genreId) => {
    const item = targets.get(genreId);
    const row = rowById.get(genreId);
    const targetYen = item && item.targetYen > 0 ? item.targetYen : null;
    const days = buildCumulative({
      lines: linesForGoal(buildCategoryLines(txs, genreId, period, today), period),
      monthStart: period.from,
      monthEnd: period.to,
      today,
      recordStart: period.from,
      goal: targetYen !== null ? { range: period, budgetYen: targetYen } : null,
      remaining: forecast ? remainingOfCategory(forecast, genreId) : null,
    }).days;
    let spent = 0;
    let scheduled = 0;
    for (const d of days) {
      if (d.actualYen !== null) spent = d.actualYen;
      scheduled += d.scheduledYen;
    }
    const prev = lastMonth.get(genreId) ?? null;
    const p50 = row?.p50 ?? null;
    const caution = row?.caution ?? null;
    const sub = caution
      ? prev !== null && p50 !== null && p50 > prev * 1.3
        ? '先月より大きく増えそう'
        : 'このままだと目標をこえそう'
      : started && spent > 0
        ? `いまのペース 1日 約${Math.round(spent / elapsedDays).toLocaleString('ja-JP')}円`
        : (item?.reason ?? null);
    return {
      genreId,
      name: item?.genreName ?? nameById.get(genreId) ?? '未分類',
      targetYen,
      spentYen: spent,
      scheduledYen: scheduled,
      lastMonthYen: prev,
      p10: row?.p10 ?? null,
      p50,
      p90: row?.p90 ?? null,
      caution: caution ? { probability: caution.probability } : null,
      fixed: closed.has(genreId) || row?.group === 'fixed',
      sub,
      days,
    };
  });

  return { period, remainingDays, forecast: loaded, rows, genres, transactions, outlooks };
}
