/**
 * ジャンル画面の「もし、へらしたら」(設計書のジャンルの試算)の読み込み(サーバー)。
 *
 * 目標の期間中で、このジャンルが目標に入っていれば、ホーム・レポートと同じ目標の範囲の予測から
 * 出す(全体で予算に収まる確率が、ホームの数字と一致する)。目標の外なら今月のすべての支出の
 * 予測から出し、ジャンルの予算を目標として使う。月末の収支は、今月のすべての支出の予測の収支に、
 * へらしたぶんを足した目安。
 *
 * 約束(「決める」、ADR-075)は、今月の約束と、先月の約束が守れたかを一緒に返す。守れたかは
 * 「その月にこのジャンルで使った額(家計簿と同じ数え方)が、決めた時点の約束どおりの見込み
 * (中央)以下か」で決める。
 */

import { genreSpentYen, promiseKept } from '@/domain/forecast/promise';
import type { ForecastWhatIf, ForecastWhatIfOption } from '@/domain/forecast/types';
import { getCurrentPlan } from '@/features/spending-plan/store';
import { loadLedgerTransactions } from '@/features/spending/entries';
import { addDays, addMonths, monthStartJst, todayJst, type DateOnly } from '@/lib/date';
import { goalForecastArgs } from './goal';
import { loadForecast } from './load';
import { listPromises, type SpendingPromise } from './promise-store';
import { toForecastSource } from './source';

export type CategoryWhatIfView = {
  genreId: string;
  categoryName: string;
  /** 1回あたりの見込みの額と、月末までの週数(「1回 約3,100円 × 残り約3.7週」)。 */
  perVisitYen: number;
  weeks: number;
  /** ジャンルの目標(目標の配分、無ければジャンルの予算)。 */
  targetYen: number | null;
  /** 全体の予算(目標の範囲のとき)。 */
  budgetYen: number | null;
  /**
   * 今月のすべての支出での、いつも通りなら(約束を入れる前の)月末の収支の見込み(中央)。
   * 収入が分からなければ null。選択肢の収支は、これに選択肢のへる額を足した目安。
   */
  balanceP50: number | null;
  options: readonly ForecastWhatIfOption[];
  /** 「これ以上は使わない」の2つの見込み(守れたとき・いつもの守り方)と守れ具合。 */
  stop: ForecastWhatIf['stop'];
  provisional: boolean;
  /** 予測の範囲での、このジャンルの使った額と、予定・固定費(ジャンル画面の「使った」「予定」)。 */
  spentYen: number;
  scheduledYen: number;
  /** 今月の約束(無ければ null)と、今月このジャンルで使った額。 */
  promise: SpendingPromise | null;
  spentThisMonthYen: number;
  /** 先月の約束が守れたか(先月に約束が無ければ null)。 */
  lastMonth: { promise: SpendingPromise; spentYen: number; kept: boolean } | null;
};

type Loaded = {
  view: CategoryWhatIfView;
  /** 今月のすべての支出の予測での「もし」(約束の見込みの額を保存するのに使う)。 */
  monthWhatIf: ForecastWhatIf | null;
};

async function load(input: {
  genreId: string;
  genreName: string;
  genreBudgetYen: number | null;
  now?: Date;
}): Promise<Loaded | null> {
  const now = input.now ?? new Date();
  const today = todayJst(now);
  const monthFrom = monthStartJst(0, now);
  const monthPeriod: { from: DateOnly; to: DateOnly } = {
    from: monthFrom,
    to: addDays(addMonths(monthFrom, 1), -1),
  };
  const lastMonthFrom = addMonths(monthFrom, -1);
  const lastMonthPeriod = { from: lastMonthFrom, to: addDays(monthFrom, -1) };
  const plan = await getCurrentPlan(today).catch(() => null);
  const goal = goalForecastArgs(plan);
  const inGoal =
    goal !== null &&
    goal.scope.genreIds?.has(input.genreId) === true &&
    goal.period.from <= today &&
    today <= goal.period.to;

  // 目標の範囲で出すときは、今月の予測は収支にだけ使う(ジャンルの目標を渡すと、目標ごとの
  // 注意の検証が別に走って重くなるため渡さない)。
  const monthTargets =
    !inGoal && input.genreBudgetYen !== null && input.genreBudgetYen > 0
      ? [
          {
            categoryId: input.genreId,
            categoryName: input.genreName,
            targetYen: input.genreBudgetYen,
          },
        ]
      : undefined;
  const [view, monthView, promises] = await Promise.all([
    inGoal ? loadForecast({ ...goal, now }) : Promise.resolve(null),
    loadForecast({
      period: monthPeriod,
      now,
      ...(monthTargets ? { categoryTargets: monthTargets } : {}),
    }),
    listPromises([monthFrom, lastMonthFrom]).catch(() => []),
  ]);
  const source = view ?? monthView;
  const whatIf = source.forecast.whatIf.find((w) => w.categoryId === input.genreId);
  if (whatIf === undefined || whatIf.options.length < 2) return null;
  const monthWhatIf = monthView.forecast.whatIf.find((w) => w.categoryId === input.genreId) ?? null;
  const row = source.forecast.byCategory.find((c) => c.categoryId === input.genreId);
  const monthRow = monthView.forecast.byCategory.find((c) => c.categoryId === input.genreId);

  const promise =
    promises.find((p) => p.genreId === input.genreId && p.month === monthFrom) ?? null;
  const lastPromise =
    promises.find((p) => p.genreId === input.genreId && p.month === lastMonthFrom) ?? null;
  let lastMonth: CategoryWhatIfView['lastMonth'] = null;
  if (lastPromise !== null) {
    const loaded = await loadLedgerTransactions(lastMonthPeriod, today).catch(() => null);
    if (loaded !== null) {
      const spentYen = genreSpentYen(
        toForecastSource(loaded.transactions),
        input.genreId,
        lastMonthPeriod,
      );
      lastMonth = {
        promise: lastPromise,
        spentYen,
        kept: promiseKept(spentYen, lastPromise.limitYen),
      };
    }
  }

  // 今月の予測の収支には約束が入っているので、いつも通りの収支に戻してから選択肢の額を足す。
  const balance = monthView.forecast.balance;
  const promisedSaved =
    monthWhatIf === null || monthWhatIf.promisedPerWeek === null
      ? 0
      : monthWhatIf.promisedPerWeek === 0
        ? monthWhatIf.stop.usual.savedYen
        : (monthWhatIf.options.find((o) => o.perWeek === monthWhatIf.promisedPerWeek)?.savedYen ??
          0);
  return {
    view: {
      genreId: input.genreId,
      categoryName: whatIf.categoryName,
      perVisitYen: whatIf.perVisitYen,
      weeks: whatIf.weeks,
      targetYen: row?.targetYen ?? null,
      budgetYen: inGoal ? goal.budgetYen : null,
      balanceP50: balance === null ? null : balance.p50 - promisedSaved,
      options: whatIf.options,
      stop: whatIf.stop,
      provisional: source.forecast.provisional,
      spentYen: row?.actualYen ?? 0,
      scheduledYen: (row?.scheduledYen ?? 0) + (row?.fixedYen ?? 0),
      promise,
      spentThisMonthYen: monthRow?.actualYen ?? 0,
      lastMonth,
    },
    monthWhatIf,
  };
}

export async function loadCategoryWhatIf(input: {
  genreId: string;
  genreName: string;
  genreBudgetYen: number | null;
  now?: Date;
}): Promise<CategoryWhatIfView | null> {
  return (await load(input))?.view ?? null;
}

/**
 * 約束として保存する見込みの額(今月のすべての支出の予測での、いつも通りと約束どおりの中央)。
 * 家計簿の「使った額」と同じ範囲で比べるため、目標の範囲ではなく今月のすべての支出の予測を使う。
 * 「もし」が出せない(定常型でない・残りが1週間未満など)ときは null。
 */
export async function promiseAmountsFor(input: {
  genreId: string;
  genreName: string;
  genreBudgetYen: number | null;
  perWeek: number;
  now?: Date;
}): Promise<{ usualYen: number; limitYen: number } | null> {
  const loaded = await load(input);
  const w = loaded?.monthWhatIf ?? null;
  if (w === null) return null;
  const usual = w.options[0];
  // 「これ以上は使わない」(0)は、守れたとき(月末まで使わない)の見込みを約束の額にする。
  const chosen =
    input.perWeek === 0 ? w.stop.kept : w.options.find((o) => o.perWeek === input.perWeek);
  if (usual === undefined || chosen === undefined) return null;
  return { usualYen: usual.landing.p50, limitYen: chosen.landing.p50 };
}

export { genreSpentYen };
