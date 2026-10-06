/**
 * M6:画面向けに、今月の予測(domain/forecast)を組み立てる。
 *
 * 明細は家計簿と同じ入口(loadLedgerTransactions、分割の子へ展開)から読み、
 * 予算・収入・カテゴリの目標は家計簿の月次集計(loadMonthlyLedger)の値を使う
 * (同じ期間なら全画面の数字が一致する、ADR-061)。予測の対象期間は暦月
 * (デザインの「10月の見込み」)。目標期間・給料日サイクルへの切り替えは残課題。
 */

import {
  buildActionCandidates,
  keepAsIs,
  simulateActions,
  topActions,
  weeklyReductionCandidates,
  type ActionResult,
} from '@/domain/forecast/actions';
import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { buildForecastDetailed } from '@/domain/forecast/engine';
import type { DecomposedSpending, FittedModel, Forecast } from '@/domain/forecast/types';
import { listConfirmedFixedCostKeys } from '@/features/subscriptions/fixed-cost-store';
import { loadDetectedSubscriptions } from '@/features/subscriptions/store';
import { getAppSettings } from '@/features/settings/store';
import { loadLedgerTransactions } from '@/features/spending/entries';
import type { LedgerTransaction, MonthlyLedgerView } from '@/features/spending/ledger-types';
import { loadMonthlyLedger } from '@/features/spending/store';
import { addDays, type DateOnly } from '@/lib/date';
import type { SimulateInput } from '@/domain/forecast/simulate';

/** 学習に使う過去の日数。半減期30日の重み付けなので、180日より前はほぼ効かない。 */
const TRAINING_WINDOW_DAYS = 180;
const UNCATEGORIZED_ID = 'none';

/** 明細(分割の子は展開して1行ずつ)を予測エンジンの入力にする。 */
export function toForecastSource(
  transactions: readonly LedgerTransaction[],
): ForecastSourceTransaction[] {
  return transactions.flatMap((t): ForecastSourceTransaction[] => {
    const base = {
      occurredOn: t.occurredOn,
      status: t.status,
      kind: t.kind,
      isTransfer: t.isTransfer,
      reviewStatus: t.reviewStatus,
      needsInput: t.needsInput,
      merchantName: t.label,
      description: t.description,
    };
    if (t.splits.length === 0) {
      return [{ ...base, genreId: t.genreId, genreName: t.genreName, amountYen: t.amountYen }];
    }
    return t.splits.map((s) => ({
      ...base,
      genreId: s.genreId,
      genreName: s.genreName,
      amountYen: s.amountYen,
    }));
  });
}

/** 同じ明細なら同じ値になる識別子(シードに使う。M3の決定論)。 */
export function dataVersionOf(source: readonly ForecastSourceTransaction[]): string {
  let sum = 0;
  let latest = '';
  for (const t of source) {
    sum = (sum * 31 + Math.round(t.amountYen) + t.occurredOn.length) % 2_147_483_647;
    if (t.occurredOn > latest) latest = t.occurredOn;
  }
  return `${source.length}:${latest}:${sum}`;
}

export type MonthForecastView = {
  period: { from: DateOnly; to: DateOnly };
  today: DateOnly;
  /** 「10月」 */
  monthLabel: string;
  budgetYen: number | null;
  incomeYen: number;
  forecast: Forecast;
  decomposed: DecomposedSpending;
  /** 次の一手(効果の大きい順、最大2件)。予算が無ければ空。 */
  actions: readonly ActionResult[];
  /** カテゴリ別の目標(ジャンルの予算)。 */
  categoryTargets: ReadonlyMap<string, number>;
  /** 期間の初日から今日までの、通常支出の累計(扇形グラフの実線)。 */
  actualCumulative: readonly { date: DateOnly; yen: number }[];
  /** 打ち手の試算をやり直すための材料(サーバー内でだけ使う)。 */
  internal: { fitted: FittedModel; simulateInput: SimulateInput; dataVersion: string };
};

async function prepare(ledger: MonthlyLedgerView): Promise<MonthForecastView> {
  const today = ledger.period.to;
  const period = { from: ledger.period.from, to: monthEnd(ledger.period.from) };
  const trainingFrom = addDays(today, -TRAINING_WINDOW_DAYS);

  const [loaded, confirmedFixedKeys, detectedSubscriptions, settings] = await Promise.all([
    loadLedgerTransactions({ from: trainingFrom, to: period.to }, today),
    listConfirmedFixedCostKeys().catch(() => new Set<string>()),
    loadDetectedSubscriptions().catch(() => []),
    getAppSettings().catch(() => null),
  ]);

  const source = toForecastSource(loaded.transactions);
  const dataVersion = dataVersionOf(source);
  const categoryTargets = new Map<string, number>();
  for (const row of ledger.genreBreakdown) {
    if (row.budgetYen !== null) categoryTargets.set(row.genreId ?? UNCATEGORIZED_ID, row.budgetYen);
  }
  const budgetYen = ledger.forecast.totalBudgetYen;

  const detailed = buildForecastDetailed({
    transactions: source,
    period,
    today,
    trainingFrom,
    recordStart: ledger.record.firstRecordedOn,
    confirmedFixedKeys,
    detectedSubscriptions,
    budgetYen,
    payday: settings?.payday ?? null,
    dataVersion,
    categoryTargets,
  });

  const actionInput = actionInputOf(detailed.simulateInput, dataVersion, categoryTargets);
  const actions =
    budgetYen === null
      ? []
      : topActions(
          simulateActions(
            actionInput,
            buildActionCandidates(
              detailed.forecast.drivers,
              detailed.fitted.categories,
              detailed.forecast.remainingDays,
            ),
          ),
        );

  return {
    period,
    today,
    monthLabel: `${Number(period.from.slice(5, 7))}月`,
    budgetYen,
    incomeYen: ledger.totalIncomeYen,
    forecast: detailed.forecast,
    decomposed: detailed.decomposed,
    actions,
    categoryTargets,
    actualCumulative: cumulativeActual(source, period.from, today),
    internal: { fitted: detailed.fitted, simulateInput: detailed.simulateInput, dataVersion },
  };
}

function actionInputOf(
  sim: SimulateInput,
  dataVersion: string,
  categoryTargets: ReadonlyMap<string, number>,
) {
  return {
    periodId: sim.periodId,
    today: sim.today,
    periodTo: sim.periodTo,
    fitted: sim.fitted,
    committedYen: sim.committedYen,
    actualYen: sim.actualYen,
    specialHistoricalAmounts: sim.specialHistoricalAmounts,
    specialOccurrencesPerDay: sim.specialOccurrencesPerDay,
    remainingDays: sim.remainingDays,
    budgetYen: sim.budgetYen,
    payday: sim.payday,
    dataVersion,
    ...(sim.categoryBases ? { categoryBases: sim.categoryBases } : {}),
    categoryTargets,
  };
}

/** 予測エンジンの「実績」と同じ数え方(通常支出・振替/対象外/入力待ちを除く)の日ごとの累計。 */
export function cumulativeActual(
  source: readonly ForecastSourceTransaction[],
  from: DateOnly,
  to: DateOnly,
): { date: DateOnly; yen: number }[] {
  const byDay = new Map<DateOnly, number>();
  for (const t of source) {
    if (t.kind !== 'normal' || t.status !== 'actual' || t.isTransfer || t.needsInput) continue;
    if (t.reviewStatus === 'ignored' || t.amountYen >= 0) continue;
    if (t.occurredOn < from || t.occurredOn > to) continue;
    byDay.set(t.occurredOn, (byDay.get(t.occurredOn) ?? 0) - t.amountYen);
  }
  const out: { date: DateOnly; yen: number }[] = [];
  let running = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    running += byDay.get(d) ?? 0;
    out.push({ date: d, yen: running });
  }
  return out;
}

function monthEnd(monthStart: DateOnly): DateOnly {
  const [y, m] = monthStart.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${monthStart.slice(0, 8)}${String(last).padStart(2, '0')}`;
}

/**
 * 今月の予測。家計簿の月次集計が手元にあれば渡す(読み込みの重複を避ける)。
 * 予測は補助的な表示のため、失敗しても画面全体は落とさず null を返す。
 */
export async function loadMonthForecast(
  ledger?: MonthlyLedgerView,
): Promise<MonthForecastView | null> {
  try {
    return await prepare(ledger ?? (await loadMonthlyLedger()));
  } catch {
    return null;
  }
}

export type CategoryWhatIf = {
  view: MonthForecastView;
  categoryId: string;
  categoryName: string;
  /** 「いつも通り」「週1回へらす」「週2回へらす」の順。 */
  options: readonly ActionResult[];
};

/** 1カテゴリの「もし〜なら」(M5の打ち手を、選択肢として並べる)。 */
export async function loadCategoryWhatIf(categoryId: string): Promise<CategoryWhatIf | null> {
  const view = await loadMonthForecast();
  if (view === null) return null;
  const band = view.forecast.byCategory.find((c) => c.categoryId === categoryId);
  const modeled = view.internal.fitted.categories.some((c) => c.categoryId === categoryId);
  if (band === undefined || !modeled) return null;
  const candidates = [
    keepAsIs(categoryId, band.categoryName),
    ...weeklyReductionCandidates(categoryId, band.categoryName, view.forecast.remainingDays),
  ];
  const options = simulateActions(
    actionInputOf(view.internal.simulateInput, view.internal.dataVersion, view.categoryTargets),
    candidates,
  );
  return { view, categoryId, categoryName: band.categoryName, options };
}
