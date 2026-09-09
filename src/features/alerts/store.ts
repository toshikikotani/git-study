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
 * M3-1(通知基盤)・M3-3(アラートジョブ)の責務。
 */

import { detectPaymentDueTomorrow, type CandidateAlert } from '@/domain/alerts';
import { createClient } from '@/lib/supabase/server';
import { todayJst, type DateOnly } from '@/lib/date';

export class AlertStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlertStoreError';
  }
}

/**
 * 候補を alerts へ積む。重複(同じ dedup_key)は静かに無視する。
 * @returns 実際に新規で積んだ件数
 */
export async function recordAlerts(candidates: readonly CandidateAlert[]): Promise<number> {
  if (candidates.length === 0) return 0;

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new AlertStoreError('ログイン状態を確認できませんでした');
  }

  const { data, error } = await supabase
    .from('alerts')
    .upsert(
      candidates.map((c) => ({
        user_id: auth.user.id,
        kind: c.kind,
        severity: c.severity,
        title: c.title,
        body: c.body,
        dedup_key: c.dedupKey,
        debt_id: c.debtId,
      })),
      { onConflict: 'user_id,dedup_key', ignoreDuplicates: true },
    )
    .select('id');

  if (error) throw new AlertStoreError(`通知を記録できませんでした: ${error.message}`);
  return data.length;
}

/**
 * FR-23:返済日前日の通知を検知して積む。
 * 対象は active な負債(debts.status='active')のみ。
 */
export async function detectAndRecordPaymentDueAlerts(now: Date = new Date()): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('debts')
    .select('id, lender_name, payment_day')
    .eq('status', 'active');
  if (error) throw new AlertStoreError(`負債を取得できませんでした: ${error.message}`);

  const today: DateOnly = todayJst(now);
  const candidates = detectPaymentDueTomorrow(
    data.map((d) => ({ id: d.id, lenderName: d.lender_name, paymentDay: d.payment_day })),
    today,
  );

  return recordAlerts(candidates);
}
