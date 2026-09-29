/**
 * 期間つきの支出目標(spending_plans / spending_plan_items、ADR-058)の
 * データアクセス。RLS が本人の行だけに絞る(ADR-011)。
 *
 * `spending_plans` は本番未適用のあいだがある(supabase/apply-pending.sql)。
 * 未適用時の扱いは lib/supabase/errors.ts:読み取りは「まだ無い」として空で返し、
 * 書き込みは握り潰さずエラーにする。
 */

import { planPeriodDays } from '@/domain/spending-plan';
import { summarizeLedger } from '@/domain/ledger';
import { loadLedgerTransactions } from '@/features/spending/entries';
import { toLedgerEntries } from '@/features/spending/views';
import { assertDateOnly, todayJst, type DateOnly } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

export class SpendingPlanStoreError extends AppError {}

const MAX_PERIOD_DAYS = 366;

export type SpendingPlanItem = {
  genreId: string;
  genreName: string;
  targetYen: number;
  aiSuggestedYen: number | null;
  reason: string | null;
};

export type SpendingPlan = {
  id: string;
  periodStart: DateOnly;
  periodEnd: DateOnly;
  stepPercent: number;
  createdAt: string;
  items: SpendingPlanItem[];
};

export type SpendingPlanInput = {
  periodStart: string;
  periodEnd: string;
  stepPercent: number;
  items: readonly {
    genreId: string;
    targetYen: number;
    aiSuggestedYen: number | null;
    reason: string | null;
  }[];
};

/** 直近に立てた目標(新しい順の先頭)。無ければ null。 */
export async function getLatestPlan(): Promise<SpendingPlan | null> {
  const supabase = await createClient();
  const { data: plans, error } = await supabase
    .from('spending_plans')
    .select('id, period_start, period_end, step_percent, created_at')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    if (isMissingTableError(error)) return null;
    throw new SpendingPlanStoreError(`目標を取得できませんでした: ${error.message}`);
  }
  const plan = plans[0];
  if (plan === undefined) return null;

  const [{ data: items, error: itemsError }, { data: genres, error: genresError }] =
    await Promise.all([
      supabase
        .from('spending_plan_items')
        .select('genre_id, target_yen, ai_suggested_yen, reason')
        .eq('plan_id', plan.id),
      supabase.from('genres').select('id, name, sort_order').order('sort_order'),
    ]);
  if (itemsError) {
    throw new SpendingPlanStoreError(`目標の内訳を取得できませんでした: ${itemsError.message}`);
  }
  if (genresError) {
    throw new SpendingPlanStoreError(`ジャンルを取得できませんでした: ${genresError.message}`);
  }
  const orderById = new Map(genres.map((g, i) => [g.id, i]));
  const nameById = new Map(genres.map((g) => [g.id, g.name]));

  return {
    id: plan.id,
    periodStart: plan.period_start,
    periodEnd: plan.period_end,
    stepPercent: plan.step_percent,
    createdAt: plan.created_at,
    items: items
      .filter((item) => nameById.has(item.genre_id))
      .map((item) => ({
        genreId: item.genre_id,
        genreName: nameById.get(item.genre_id)!,
        targetYen: item.target_yen,
        aiSuggestedYen: item.ai_suggested_yen,
        reason: item.reason,
      }))
      .sort((a, b) => (orderById.get(a.genreId) ?? 0) - (orderById.get(b.genreId) ?? 0)),
  };
}

function assertPlanInput(input: SpendingPlanInput): void {
  const start = assertDateOnly(input.periodStart);
  const end = assertDateOnly(input.periodEnd);
  if (end < start) throw new SpendingPlanStoreError('終了日は開始日以降を選んでください');
  if (planPeriodDays(start, end) > MAX_PERIOD_DAYS) {
    throw new SpendingPlanStoreError('期間は1年以内にしてください');
  }
  if (!Number.isInteger(input.stepPercent) || input.stepPercent < 0 || input.stepPercent > 50) {
    throw new SpendingPlanStoreError('改善の強さが正しくありません');
  }
  if (input.items.length === 0) throw new SpendingPlanStoreError('目標が1件もありません');
  for (const item of input.items) {
    if (!Number.isInteger(item.targetYen) || item.targetYen < 0) {
      throw new SpendingPlanStoreError('目標額は0円以上の整数で入力してください');
    }
  }
}

/** 目標を新しく保存する(直近の目標として扱われる。過去の目標は残す)。 */
export async function savePlan(input: SpendingPlanInput): Promise<void> {
  assertPlanInput(input);

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new SpendingPlanStoreError('ログイン状態を確認できませんでした');
  }

  const { data: plan, error } = await supabase
    .from('spending_plans')
    .insert({
      user_id: auth.user.id,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      step_percent: input.stepPercent,
    })
    .select('id')
    .single();
  if (error) {
    if (isMissingTableError(error)) {
      throw new SpendingPlanStoreError(
        '目標を保存するテーブルがまだありません。マイグレーションの適用が必要です。',
      );
    }
    throw new SpendingPlanStoreError(`目標を保存できませんでした: ${error.message}`);
  }

  const { error: itemsError } = await supabase.from('spending_plan_items').insert(
    input.items.map((item) => ({
      plan_id: plan.id,
      user_id: auth.user.id,
      genre_id: item.genreId,
      target_yen: item.targetYen,
      ai_suggested_yen: item.aiSuggestedYen,
      reason: item.reason,
    })),
  );
  if (itemsError) {
    await supabase.from('spending_plans').delete().eq('id', plan.id);
    throw new SpendingPlanStoreError(`目標の内訳を保存できませんでした: ${itemsError.message}`);
  }
}

/**
 * 保存済みの目標のジャンルごとの金額だけを直す(配分の微調整)。期間・提案額・
 * 理由は変えない。計画に無いジャンルは触らない。
 */
export async function updatePlanTargets(
  planId: string,
  items: readonly { genreId: string; targetYen: number }[],
): Promise<void> {
  for (const item of items) {
    if (!Number.isInteger(item.targetYen) || item.targetYen < 0) {
      throw new SpendingPlanStoreError('目標額は0円以上の整数で入力してください');
    }
  }
  const supabase = await createClient();
  const results = await Promise.all(
    items.map((item) =>
      supabase
        .from('spending_plan_items')
        .update({ target_yen: item.targetYen })
        .eq('plan_id', planId)
        .eq('genre_id', item.genreId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    throw new SpendingPlanStoreError(`目標を更新できませんでした: ${failed.error.message}`);
  }
}

export async function deletePlan(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('spending_plans').delete().eq('id', id);
  if (error) throw new SpendingPlanStoreError(`目標を削除できませんでした: ${error.message}`);
}

/**
 * 期間内のジャンル別の実支出(正の円)。集計は家計簿と同じ domain/ledger.ts の
 * summarizeLedger() で、分割した明細は子のジャンルで数える。
 *
 *   - 今日より未来の明細(予定)は実績に入れない(scheduledYen に分ける)
 *   - 特別費は byGenre / uncategorizedYen に入れず specialYen に分ける
 *     (目標のペース計算・見込みに混ぜない)
 *   - 未分類は uncategorizedYen にまとめる。振替・対象外は除く
 */
export async function loadGenreSpend(
  start: DateOnly,
  end: DateOnly,
  now: Date = new Date(),
): Promise<{
  byGenre: Map<string, number>;
  uncategorizedYen: number;
  specialYen: number;
  scheduledYen: number;
}> {
  const today = todayJst(now);
  let transactions;
  try {
    ({ transactions } = await loadLedgerTransactions({ from: start, to: end }, today));
  } catch (error) {
    throw new SpendingPlanStoreError(
      error instanceof Error ? error.message : '明細を取得できませんでした',
    );
  }
  const summary = summarizeLedger(toLedgerEntries(transactions), { from: start, to: end }, today);
  const byGenre = new Map<string, number>();
  for (const [genreId, yen] of summary.byGenrePace) {
    if (genreId !== null) byGenre.set(genreId, yen);
  }
  return {
    byGenre,
    uncategorizedYen: summary.byGenrePace.get(null) ?? 0,
    specialYen: summary.specialYen,
    scheduledYen: summary.scheduledYen,
  };
}
