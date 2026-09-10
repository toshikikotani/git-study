/**
 * 給料日チェックリスト(transfer_runs / transfer_run_items)のデータアクセス(M4-4、FR-15)。
 *
 * ── 入金額をどこから得るか ───────────────────────────────────
 * 「毎月いくら入るか」を固定で持つ設定は無い(給与は変動しうる)。そのため
 * チェックリストを新規に作るときだけ、本人に実際の入金額を入力してもらい、
 * それを基準に fixed/percentage/remainder を按分する(domain/transfer-rule.ts
 * の computeTransferPlan())。
 *
 * ── 「給料日に開くと出る」をどう判定するか ───────────────────
 * `app_settings.payday` から今月の給料日(run_on)を求める。
 *   1. 未完了(pending)の実行が既にあれば、それを最優先で見せる
 *      (前回以前の分もチェックし忘れを追いかける)
 *   2. 無ければ、今月分の run_on に対する実行が既に存在するかを見る。
 *      存在する(=完了済み)なら何も出さない。無ければ「今日が今月の給料日
 *      以降か」を見て、以降なら入金額の入力を促す
 * この2段構えで「翌月まで再生成されない」(ux_transfer_runs_user_trigger_date、
 * user_id + trigger + run_on の一意制約)を満たしつつ、当日開けなくても
 * 数日以内なら追いつける。
 */

import { computeTransferPlan, type PlannableRule } from '@/domain/transfer-rule';
import { getAppSettings } from '@/features/settings/store';
import { listTransferRules } from '@/features/transfer-rules/store';
import { addMonthsToParts, splitDateOnly, type DateOnly } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

type TransferRunStatus = Database['public']['Enums']['transfer_run_status'];

export type TransferRunItem = {
  id: string;
  ruleId: string | null;
  executionOrder: number;
  label: string;
  plannedAmountYen: number;
  actualAmountYen: number | null;
  isDone: boolean;
};

export type TransferRun = {
  id: string;
  runOn: DateOnly;
  sourceAmountYen: number;
  status: TransferRunStatus;
  items: TransferRunItem[];
};

export type PaydayChecklistState =
  | { kind: 'none' }
  | { kind: 'needs_amount'; paydayOn: DateOnly }
  | { kind: 'checklist'; run: TransferRun };

export class TransferRunStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferRunStoreError';
  }
}

const PAYDAY = 'payday' as const;

/** 今日を含む月の給料日(月末に無い日は月末に丸める、ADR-015と同じ考え方)。 */
function thisMonthsPayday(today: DateOnly, payday: number): DateOnly {
  const [year, month] = splitDateOnly(today);
  return addMonthsToParts(year, month, payday, 0);
}

export async function resolvePaydayChecklistState(today: DateOnly): Promise<PaydayChecklistState> {
  const supabase = await createClient();

  const { data: pendingRow, error: pendingError } = await supabase
    .from('transfer_runs')
    .select('id, run_on, source_amount_yen, status')
    .eq('trigger', PAYDAY)
    .eq('status', 'pending')
    .order('run_on', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingError) {
    throw new TransferRunStoreError(`実行状況を取得できませんでした: ${pendingError.message}`);
  }
  if (pendingRow) {
    return { kind: 'checklist', run: await loadRunWithItems(pendingRow.id) };
  }

  const settings = await getAppSettings();
  const paydayOn = thisMonthsPayday(today, settings.payday);

  const { data: existingRow, error: existingError } = await supabase
    .from('transfer_runs')
    .select('id')
    .eq('trigger', PAYDAY)
    .eq('run_on', paydayOn)
    .maybeSingle();
  if (existingError) {
    throw new TransferRunStoreError(`実行状況を取得できませんでした: ${existingError.message}`);
  }
  if (existingRow) {
    // 今月分は既に完了済み(pending であれば上のチェックで拾っている)
    return { kind: 'none' };
  }

  if (today < paydayOn) {
    return { kind: 'none' };
  }
  return { kind: 'needs_amount', paydayOn };
}

/**
 * 入金額から按分し、チェックリスト一式(実行 + 項目)を新規作成する。
 * 有効な振替ルールが1件も無ければ作れない(何を消化すればいいか決まらない)。
 */
export async function createPaydayRun(
  sourceAmountYen: number,
  runOn: DateOnly,
): Promise<TransferRun> {
  const rules = await listTransferRules();
  if (rules.length === 0) {
    throw new TransferRunStoreError('振替ルールが1件もありません。先にルールを登録してください。');
  }

  const plannable: PlannableRule[] = rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    amountType: rule.amountType,
    amountYen: rule.amountYen,
    percentage: rule.percentage,
  }));
  const plan = computeTransferPlan(plannable, sourceAmountYen);

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new TransferRunStoreError('ログイン状態を確認できませんでした');
  }

  const { data: runRow, error: runError } = await supabase
    .from('transfer_runs')
    .insert({
      user_id: auth.user.id,
      trigger: PAYDAY,
      run_on: runOn,
      source_amount_yen: sourceAmountYen,
    })
    .select('id')
    .single();
  if (runError) {
    throw new TransferRunStoreError(`チェックリストを作成できませんでした: ${runError.message}`);
  }

  const itemRows = plan.map((item, index) => ({
    user_id: auth.user.id,
    run_id: runRow.id,
    rule_id: item.ruleId,
    execution_order: index + 1,
    label: item.label,
    planned_amount_yen: item.plannedAmountYen,
  }));
  const { error: itemsError } = await supabase.from('transfer_run_items').insert(itemRows);
  if (itemsError) {
    throw new TransferRunStoreError(
      `チェックリストの項目を作成できませんでした: ${itemsError.message}`,
    );
  }

  return loadRunWithItems(runRow.id);
}

/**
 * 項目のチェック状態を切り替える。
 * チェックしたときは予定額どおり実行したものとして actual_amount_yen を埋める
 * (実額の個別修正は本 MVP の範囲外)。全項目が完了すれば実行自体も完了にする。
 */
export async function setTransferRunItemDone(itemId: string, isDone: boolean): Promise<void> {
  const supabase = await createClient();

  const { data: item, error: itemError } = await supabase
    .from('transfer_run_items')
    .select('run_id, planned_amount_yen')
    .eq('id', itemId)
    .single();
  if (itemError) {
    throw new TransferRunStoreError(`項目を取得できませんでした: ${itemError.message}`);
  }

  const { error: updateError } = await supabase
    .from('transfer_run_items')
    .update({
      is_done: isDone,
      done_at: isDone ? new Date().toISOString() : null,
      actual_amount_yen: isDone ? item.planned_amount_yen : null,
    })
    .eq('id', itemId);
  if (updateError) {
    throw new TransferRunStoreError(`項目を更新できませんでした: ${updateError.message}`);
  }

  const { data: siblings, error: siblingsError } = await supabase
    .from('transfer_run_items')
    .select('is_done')
    .eq('run_id', item.run_id);
  if (siblingsError) {
    throw new TransferRunStoreError(`実行の状態を確認できませんでした: ${siblingsError.message}`);
  }

  const allDone = siblings.every((s) => s.is_done);
  const { error: runUpdateError } = await supabase
    .from('transfer_runs')
    .update({
      status: allDone ? 'completed' : 'pending',
      completed_at: allDone ? new Date().toISOString() : null,
    })
    .eq('id', item.run_id);
  if (runUpdateError) {
    throw new TransferRunStoreError(`実行の状態を更新できませんでした: ${runUpdateError.message}`);
  }
}

async function loadRunWithItems(runId: string): Promise<TransferRun> {
  const supabase = await createClient();

  const { data: runRow, error: runError } = await supabase
    .from('transfer_runs')
    .select('id, run_on, source_amount_yen, status')
    .eq('id', runId)
    .single();
  if (runError) {
    throw new TransferRunStoreError(`実行を取得できませんでした: ${runError.message}`);
  }

  const { data: itemRows, error: itemsError } = await supabase
    .from('transfer_run_items')
    .select('id, rule_id, execution_order, label, planned_amount_yen, actual_amount_yen, is_done')
    .eq('run_id', runId)
    .order('execution_order', { ascending: true });
  if (itemsError) {
    throw new TransferRunStoreError(`実行の項目を取得できませんでした: ${itemsError.message}`);
  }

  return {
    id: runRow.id,
    runOn: runRow.run_on,
    sourceAmountYen: runRow.source_amount_yen,
    status: runRow.status,
    items: itemRows.map((row) => ({
      id: row.id,
      ruleId: row.rule_id,
      executionOrder: row.execution_order,
      label: row.label,
      plannedAmountYen: row.planned_amount_yen,
      actualAmountYen: row.actual_amount_yen,
      isDone: row.is_done,
    })),
  };
}
