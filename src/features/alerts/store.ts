/**
 * 通知(alerts)のデータアクセスと検知の実行(M3-2)。
 *
 * 判断(いつ発火させるか)は domain/alerts.ts の純粋関数に任せ、
 * ここでは「DB から何を読むか」「DB へどう書くか」だけを担う。
 *
 * ── 重複防止 ──────────────────────────────────────────────
 * (user_id, dedup_key) が一意(ux_alerts_user_dedup)。upsert に
 * ignoreDuplicates を指定し、同じ事象を二度書き込まない・エラーにも
 * しない(設計原則3、NFR-06)。
 *
 * ── 送信について ────────────────────────────────────────────
 * ここでは status='pending' で積むところまで。Discord への送信は
 * features/alerts/notify.ts(M3-1)の責務。
 *
 * ── *AsAdmin 関数について(M3-3)────────────────────────────
 * `/api/cron/detect-alerts` には本人のセッション(cookie)が無いため、
 * `createAdminClient()` + 明示的な user_id で読み書きする必要がある
 * (`app/api/cron/keepalive/route.ts` と同じ考え方)。`recordAlerts()` は
 * RLS の `with check (user_id = auth.uid())` を満たす限り admin client
 * でもそのまま使えるため、*AsAdmin 版はそれぞれ「検知対象の読み出しを
 * user_id で絞る」部分だけを担う薄いラッパーにしてある。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildJobFailureAlert,
  detectInactivity,
  detectPaymentDueTomorrow,
  detectRiskyTransaction,
  detectWastefulBudget,
  type CandidateAlert,
} from '@/domain/alerts';
import { budgetStatusFor, type BudgetTransaction, type CategoryBudget } from '@/domain/budget';
import { isRiskyPaymentMethod } from '@/features/classification/rules';
import { monthStartJst, todayJst, type DateOnly } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

export class AlertStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlertStoreError';
  }
}

/**
 * 候補を alerts へ積む(admin client 版)。重複(同じ dedup_key)は静かに無視する。
 * @returns 実際に新規で積んだ件数
 */
export async function recordAlertsAsAdmin(
  client: SupabaseClient<Database>,
  userId: string,
  candidates: readonly CandidateAlert[],
): Promise<number> {
  if (candidates.length === 0) return 0;

  const { data, error } = await client
    .from('alerts')
    .upsert(
      candidates.map((c) => ({
        user_id: userId,
        kind: c.kind,
        severity: c.severity,
        title: c.title,
        body: c.body,
        dedup_key: c.dedupKey,
        debt_id: c.debtId,
        transaction_id: c.transactionId,
      })),
      { onConflict: 'user_id,dedup_key', ignoreDuplicates: true },
    )
    .select('id');

  if (error) throw new AlertStoreError(`通知を記録できませんでした: ${error.message}`);
  return data.length;
}

/** 候補を alerts へ積む(本人のセッション版)。 */
export async function recordAlerts(candidates: readonly CandidateAlert[]): Promise<number> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new AlertStoreError('ログイン状態を確認できませんでした');
  }
  return recordAlertsAsAdmin(supabase, auth.user.id, candidates);
}

/**
 * FR-23:返済日前日の通知を検知して積む。
 * 対象は active な負債(debts.status='active')のみ。
 */
export async function detectAndRecordPaymentDueAlertsAsAdmin(
  client: SupabaseClient<Database>,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const { data, error } = await client
    .from('debts')
    .select('id, lender_name, payment_day')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (error) throw new AlertStoreError(`負債を取得できませんでした: ${error.message}`);

  const today: DateOnly = todayJst(now);
  const candidates = detectPaymentDueTomorrow(
    data.map((d) => ({ id: d.id, lenderName: d.lender_name, paymentDay: d.payment_day })),
    today,
  );

  return recordAlertsAsAdmin(client, userId, candidates);
}

export async function detectAndRecordPaymentDueAlerts(now: Date = new Date()): Promise<number> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new AlertStoreError('ログイン状態を確認できませんでした');
  }
  return detectAndRecordPaymentDueAlertsAsAdmin(supabase, auth.user.id, now);
}

/**
 * FR-22:3日以上明細が取り込まれていなければ知らせる(T-21)。
 * 「直近の取り込み日」は import_batches の最新行から求める。
 */
export async function detectAndRecordInactivityAlertAsAdmin(
  client: SupabaseClient<Database>,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const { data, error } = await client
    .from('import_batches')
    .select('created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new AlertStoreError(`取り込み履歴を取得できませんでした: ${error.message}`);

  const lastImportedOn: DateOnly | null = data ? todayJst(new Date(data.created_at)) : null;
  const candidate = detectInactivity(lastImportedOn, todayJst(now));
  return candidate ? recordAlertsAsAdmin(client, userId, [candidate]) : 0;
}

/**
 * FR-21:リボ払い・キャッシング・分割払いを検知して積む(再発防止の最重要
 * トリガー)。過去分も含めて毎回全件スキャンする(dedup_key が取引単位
 * なので、二重通知は DB の一意制約が防ぐ。個人の利用規模ならこれで十分)。
 */
export async function detectAndRecordRiskyTransactionAlertsAsAdmin(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<number> {
  // 絞り込みは isRiskyPaymentMethod() が正。DB 側の in() は
  // クエリを軽くするためだけの重複(値が増えたらここも直す)。
  const { data, error } = await client
    .from('transactions')
    .select('id, description, amount_yen, payment_method')
    .eq('user_id', userId)
    .in('payment_method', ['revolving', 'cashing', 'installment']);
  if (error) throw new AlertStoreError(`明細を取得できませんでした: ${error.message}`);

  const candidates = data
    .filter((t): t is typeof t & { payment_method: 'revolving' | 'cashing' | 'installment' } =>
      isRiskyPaymentMethod(t.payment_method),
    )
    .map((t) =>
      detectRiskyTransaction({
        id: t.id,
        description: t.description,
        amountYen: t.amount_yen,
        paymentMethod: t.payment_method,
      }),
    );

  return recordAlertsAsAdmin(client, userId, candidates);
}

/**
 * FR-20:浪費カテゴリ(categories.kind='waste')が月予算の70%に達したら知らせる。
 * 判定そのものは domain/alerts.ts の detectWastefulBudget() が正。
 */
export async function detectAndRecordWastefulBudgetAlertsAsAdmin(
  client: SupabaseClient<Database>,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const { data: categories, error } = await client
    .from('categories')
    .select('id, name, default_monthly_budget_yen')
    .eq('user_id', userId)
    .eq('kind', 'waste')
    .eq('is_active', true);
  if (error) throw new AlertStoreError(`カテゴリを取得できませんでした: ${error.message}`);
  if (categories.length === 0) return 0;

  const monthStart = monthStartJst(0, now);
  const categoryIds = categories.map((c) => c.id);

  const { data: budgets, error: budgetError } = await client
    .from('budgets')
    .select('category_id, amount_yen, carry_over_yen')
    .eq('user_id', userId)
    .eq('month', monthStart)
    .in('category_id', categoryIds);
  if (budgetError) throw new AlertStoreError(`予算を取得できませんでした: ${budgetError.message}`);
  const budgetByCategory = new Map(budgets.map((b) => [b.category_id, b]));

  const { data: transactions, error: txError } = await client
    .from('transactions')
    .select('category_id, amount_yen, is_transfer, review_status')
    .eq('user_id', userId)
    .in('category_id', categoryIds)
    .gte('occurred_on', monthStart)
    .lt('occurred_on', monthStartJst(1, now));
  if (txError) throw new AlertStoreError(`明細を取得できませんでした: ${txError.message}`);

  const budgetTransactions: BudgetTransaction[] = transactions.map((t) => ({
    categoryId: t.category_id,
    amountYen: t.amount_yen,
    isTransfer: t.is_transfer,
    reviewStatus: t.review_status,
  }));

  const monthKey = monthStart.slice(0, 7);
  const candidates = categories
    .map((c) => {
      const budget = budgetByCategory.get(c.id);
      const categoryBudget: CategoryBudget = {
        categoryId: c.id,
        code: c.id,
        budgetYen: budget?.amount_yen ?? c.default_monthly_budget_yen,
        carryOverYen: budget?.carry_over_yen ?? 0,
      };
      return detectWastefulBudget(
        { id: c.id, name: c.name },
        budgetStatusFor(categoryBudget, budgetTransactions),
        monthKey,
      );
    })
    .filter((c): c is CandidateAlert => c !== null);

  return recordAlertsAsAdmin(client, userId, candidates);
}

/**
 * NFR-06:ジョブ失敗を alerts へ記録する(M3-3 の DoD)。
 * 記録自体が失敗しても(DB到達不能など)元の失敗の握り潰しにはしない
 * ため、呼び出し側で catch して無視する設計にしてある(投げない)。
 */
export async function recordJobFailureAlertAsAdmin(
  client: SupabaseClient<Database>,
  userId: string,
  jobName: string,
  errorMessage: string,
  now: Date = new Date(),
): Promise<void> {
  const candidate = buildJobFailureAlert(jobName, errorMessage, todayJst(now));
  await recordAlertsAsAdmin(client, userId, [candidate]);
}
