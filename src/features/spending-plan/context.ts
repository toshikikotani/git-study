/**
 * 目標の提案(AI・決め打ちの両方)に渡す、ジャンルごとの過去実績と課題を集める
 * (ADR-058)。判断は domain/spending-plan.ts と plan-ai.ts が担い、ここは
 * 「DBから何を読むか」だけを持つ。
 */

import { baselineForPeriod, planPeriodDays, type PlanGenreFacts } from '@/domain/spending-plan';
import { isCountable } from '@/domain/budget';
import { entryStatus } from '@/domain/ledger';
import { loadLedgerTransactions } from '@/features/spending/entries';
import { toLedgerEntries } from '@/features/spending/views';
import { addDays, daysBetween, todayJst, type DateOnly } from '@/lib/date';
import { isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';
import { getLatestPlan, loadGenreSpend, SpendingPlanStoreError } from './store';

/** 実績を見る期間(日)。 */
const LOOKBACK_DAYS = 90;
/** 増加傾向の判定に使う「直近」の長さ(日)。これより短い実績では判定しない。 */
const RECENT_DAYS = 30;
const TREND_RATIO = 1.15;
const WASTE_SHARE_ISSUE = 0.4;
const ID_CHUNK = 100;

export type PlanPreviousResult = {
  targetYen: number;
  spentYen: number;
  periodDays: number;
  met: boolean;
};

export type PlanGenreContext = PlanGenreFacts & {
  genreId: string;
  genreName: string;
  /** 月次予算(genres.budget_yen)。 */
  budgetYen: number | null;
  /** 直近に立てた目標に対する結果(無ければ null)。 */
  previous: PlanPreviousResult | null;
  /** 課題と判断した理由(人が読む短い文)。 */
  issueReasons: string[];
  /** 実績の1日平均(円)。 */
  dailyYen: number;
  /** 浪費判定(AI診断)の割合。診断が無ければ null。 */
  wasteShare: number | null;
  /** 直近(30日)と、それ以前の1日平均の比。判定できなければ null。 */
  trendRatio: number | null;
};

export type PlanContext = {
  periodDays: number;
  lookbackDays: number;
  genres: PlanGenreContext[];
  /** 未分類の支出(先に分類しないと目標に含められない)。 */
  uncategorizedYen: number;
};

export async function loadPlanContext(
  periodStart: DateOnly,
  periodEnd: DateOnly,
  now: Date = new Date(),
): Promise<PlanContext> {
  const supabase = await createClient();
  const today = todayJst(now);
  const lookbackFrom = addDays(today, -(LOOKBACK_DAYS - 1));

  const [{ data: genres, error: genresError }, ledger, latestPlan] = await Promise.all([
    supabase.from('genres').select('id, name, budget_yen').order('sort_order'),
    loadLedgerTransactions({ from: lookbackFrom, to: today }, today),
    getLatestPlan(),
  ]);
  if (genresError) {
    throw new SpendingPlanStoreError(`ジャンルを取得できませんでした: ${genresError.message}`);
  }

  // 家計簿と同じ集計の入力(分割の子へ展開済み)。予定と特別費はペースの基準に
  // 混ぜない(未来日の大きな支払いが「いつもの水準」に見えてしまうため)。
  const mustPayById = new Map(ledger.transactions.map((t) => [t.id, t.mustPay]));
  const countable = toLedgerEntries(ledger.transactions).filter(
    (e) =>
      isCountable(e) &&
      e.amountYen < 0 &&
      e.kind === 'normal' &&
      entryStatus(e.occurredOn, today) === 'actual',
  );
  const earliest = countable.reduce<DateOnly | null>(
    (min, r) => (min === null || r.occurredOn < min ? r.occurredOn : min),
    null,
  );
  const lookbackDays = earliest === null ? 0 : daysBetween(earliest, today) + 1;
  const periodDays = planPeriodDays(periodStart, periodEnd);

  const wasteIds = await loadWasteTransactionIds([...new Set(countable.map((r) => r.id))]);
  const recentFrom = addDays(today, -(RECENT_DAYS - 1));

  type Acc = {
    spent: number;
    mustPay: number;
    waste: number;
    recent: number;
    prior: number;
  };
  const accByGenre = new Map<string, Acc>();
  let uncategorizedYen = 0;
  for (const r of countable) {
    const genreId = r.categoryId;
    const yen = -r.amountYen;
    if (genreId === null) {
      uncategorizedYen += yen;
      continue;
    }
    const acc = accByGenre.get(genreId) ?? { spent: 0, mustPay: 0, waste: 0, recent: 0, prior: 0 };
    acc.spent += yen;
    if (mustPayById.get(r.id)) acc.mustPay += yen;
    if (wasteIds.has(r.id)) acc.waste += yen;
    if (r.occurredOn >= recentFrom) acc.recent += yen;
    else acc.prior += yen;
    accByGenre.set(genreId, acc);
  }

  const previousByGenre = await loadPreviousResults(latestPlan);
  const canJudgeTrend = lookbackDays > RECENT_DAYS + 14;
  const priorDays = Math.max(lookbackDays - RECENT_DAYS, 1);

  const contexts: PlanGenreContext[] = genres.map((g) => {
    const acc = accByGenre.get(g.id) ?? { spent: 0, mustPay: 0, waste: 0, recent: 0, prior: 0 };
    const baselineYen = baselineForPeriod(acc.spent, lookbackDays, periodDays);
    const mustPayShare = acc.spent > 0 ? acc.mustPay / acc.spent : 0;
    const wasteShare = acc.spent > 0 && wasteIds.size > 0 ? acc.waste / acc.spent : null;
    const recentDaily = acc.recent / RECENT_DAYS;
    const priorDaily = acc.prior / priorDays;
    const trendRatio = canJudgeTrend && priorDaily > 0 ? recentDaily / priorDaily : null;

    const issueReasons: string[] = [];
    if (g.budget_yen !== null && baselineYen > (g.budget_yen * periodDays) / 30) {
      issueReasons.push('月次予算を超えるペース');
    }
    if (trendRatio !== null && trendRatio >= TREND_RATIO) {
      issueReasons.push(`直近30日で${Math.round((trendRatio - 1) * 100)}%増加`);
    }
    if (wasteShare !== null && wasteShare >= WASTE_SHARE_ISSUE) {
      issueReasons.push(`浪費判定が${Math.round(wasteShare * 100)}%`);
    }

    return {
      genreId: g.id,
      genreName: g.name,
      budgetYen: g.budget_yen,
      baselineYen,
      mustPayShare,
      isIssue: issueReasons.length > 0,
      issueReasons,
      dailyYen: lookbackDays > 0 ? Math.round(acc.spent / lookbackDays) : 0,
      wasteShare,
      trendRatio,
      previous: previousByGenre.get(g.id) ?? null,
    };
  });

  return { periodDays, lookbackDays, genres: contexts, uncategorizedYen };
}

/** 浪費と診断された明細のid(診断が無い・テーブル未適用なら空)。 */
async function loadWasteTransactionIds(ids: readonly string[]): Promise<Set<string>> {
  const supabase = await createClient();
  const waste = new Set<string>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from('transaction_diagnoses')
      .select('transaction_id, verdict')
      .in('transaction_id', ids.slice(i, i + ID_CHUNK));
    if (error) {
      if (isMissingTableError(error)) return waste;
      throw new SpendingPlanStoreError(`診断結果を取得できませんでした: ${error.message}`);
    }
    for (const d of data) if (d.verdict === 'waste') waste.add(d.transaction_id);
  }
  return waste;
}

/** 直近に立てた目標が、実際の支出でどうなったか(ジャンルごと)。 */
async function loadPreviousResults(
  latestPlan: Awaited<ReturnType<typeof getLatestPlan>>,
): Promise<Map<string, PlanPreviousResult>> {
  const results = new Map<string, PlanPreviousResult>();
  if (latestPlan === null) return results;
  const { byGenre } = await loadGenreSpend(latestPlan.periodStart, latestPlan.periodEnd);
  const periodDays = planPeriodDays(latestPlan.periodStart, latestPlan.periodEnd);
  for (const item of latestPlan.items) {
    const spentYen = byGenre.get(item.genreId) ?? 0;
    results.set(item.genreId, {
      targetYen: item.targetYen,
      spentYen,
      periodDays,
      met: spentYen <= item.targetYen,
    });
  }
  return results;
}
