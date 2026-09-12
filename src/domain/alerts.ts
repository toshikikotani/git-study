/**
 * 通知の検知ロジック(M3-2)。
 *
 * FR-20(浪費70%到達)と FR-21(リボ/キャッシング/分割)の判定は
 * domain/budget.ts と features/classification/rules.ts に実装済み。
 * ここに置くのは残り2つ、FR-22(未取込・未確認)と FR-23(返済日前日)。
 *
 * ── なぜ純粋関数にするか ────────────────────────────────────
 * 「いつ発火させるか」の判断と、「DB から何を読むか」「DB へどう書くか」を
 * 分離する。判断だけをここに置けば、日付を差し替えるだけで境界値
 * (ちょうど3日目、返済日の前日ぴったり)をテストできる。
 *
 * ── dedup_key について ─────────────────────────────────────
 * alerts テーブルは (user_id, dedup_key) が一意(同じ事象を繰り返し
 * 通知しない、設計原則3)。ここで組み立てる dedup_key が、その一意性の
 * 実体になる。
 */

import { hasReachedAlertThreshold, type BudgetStatus } from '@/domain/budget';
import { formatYen } from '@/domain/money';
import { addDays, addMonthsToParts, daysBetween, splitDateOnly, type DateOnly } from '@/lib/date';

export type AlertKind =
  | 'inactivity'
  | 'payment_due'
  | 'debt_paid_off'
  | 'import_needed'
  | 'revolving_detected'
  | 'cashing_detected'
  | 'installment_detected'
  | 'waste_budget_70'
  | 'job_failure';
export type AlertSeverity = 'info' | 'warn' | 'critical';

export type CandidateAlert = {
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  body: string | null;
  dedupKey: string;
  debtId: string | null;
  transactionId: string | null;
};

/**
 * FR-22:3日以上明細が取り込まれていなければ知らせる。
 *
 * 「本人がアプリを確認していない」側の判定は、確認日時を記録する
 * 仕組み(app_checkins)がまだ配線されていないため、ここでは未対応
 * (TASKS.md T-7 の後続で追加する)。取り込みの空白日数だけを見る。
 *
 * @param lastImportedOn 直近の取り込み日。一度も取り込んでいなければ null
 * @param today 判定基準日(JST)
 */
export function detectInactivity(
  lastImportedOn: DateOnly | null,
  today: DateOnly,
): CandidateAlert | null {
  const idleDays = lastImportedOn === null ? Infinity : daysBetween(lastImportedOn, today);
  if (idleDays < 3) return null;

  return {
    kind: 'inactivity',
    severity: 'info',
    title: '明細の確認をお忘れなく',
    body:
      lastImportedOn === null
        ? 'まだ明細が取り込まれていません。CSV か通知メールから取り込んでみましょう。'
        : `${idleDays}日間、新しい明細が取り込まれていません。取り込みが空くと、リボ・キャッシングの検知が遅れます。`,
    dedupKey: `inactivity:${today}`,
    debtId: null,
    transactionId: null,
  };
}

/**
 * FR-23:返済日の前日にリマインドする。
 *
 * 返済日(1〜31)は月によって存在しない日がありうる(29〜31日等)。
 * その月の実際の末日に丸めて比較する(domain/payoff.ts と同じ考え方)。
 */
export function detectPaymentDueTomorrow(
  debts: readonly { id: string; lenderName: string; paymentDay: number }[],
  today: DateOnly,
): CandidateAlert[] {
  const tomorrow = addDays(today, 1);
  const [ty, tm] = splitDateOnly(tomorrow);

  return debts
    .filter((debt) => addMonthsToParts(ty, tm, debt.paymentDay, 0) === tomorrow)
    .map((debt) => ({
      kind: 'payment_due' as const,
      severity: 'warn' as const,
      title: `${debt.lenderName}の返済日は明日です`,
      body: null,
      dedupKey: `payment_due:${debt.id}:${tomorrow.slice(0, 7)}`,
      debtId: debt.id,
      transactionId: null,
    }));
}

/**
 * FR-21:リボ払い・キャッシング・分割払いを検知する(再発防止の最重要トリガー、
 * 仕様書13章)。判定そのものは `features/classification/rules.ts` の
 * `isRiskyPaymentMethod()` が正(ここで再定義しない)。
 *
 * dedup_key は取引そのもの(transactionId)に紐付ける。同じ取引を毎時
 * 再スキャンしても、一度通知した取引は `alerts` の一意制約で二重通知
 * されない(ADR-007 の冪等性と同じ考え方)。
 */
export function detectRiskyTransaction(transaction: {
  id: string;
  description: string;
  amountYen: number;
  paymentMethod: 'revolving' | 'cashing' | 'installment';
}): CandidateAlert {
  const labels = {
    revolving: { kind: 'revolving_detected', label: 'リボ払い' },
    cashing: { kind: 'cashing_detected', label: 'キャッシング' },
    installment: { kind: 'installment_detected', label: '分割払い' },
  } as const;
  const { kind, label } = labels[transaction.paymentMethod];

  return {
    kind,
    severity: 'critical',
    title: `${label}を検知しました`,
    body: `${transaction.description}(${Math.abs(transaction.amountYen).toLocaleString('ja-JP')}円)。該当カードの利用停止を検討してください。`,
    dedupKey: `risky_payment:${transaction.id}`,
    debtId: null,
    transactionId: transaction.id,
  };
}

/**
 * FR-20:浪費カテゴリ(categories.kind='waste')が月予算の閾値(既定70%)に
 * 達したら知らせる。判定そのものは `domain/budget.ts` の
 * `hasReachedAlertThreshold()` が正(ここで再定義しない)。
 *
 * 100%到達では遅い、まだ使える段階で知らせる(設計原則3)。文言は
 * 「使いすぎ」のような咎める表現を避け、残額を事実として伝えるだけに
 * とどめる(FR-64)。
 *
 * dedup_key は月単位(`payment_due` と同じ考え方)。月が変われば
 * 再度70%に達したときにもう一度通知する。
 */
export function detectWastefulBudget(
  category: { id: string; name: string },
  status: BudgetStatus,
  monthKey: string,
  threshold = 0.7,
): CandidateAlert | null {
  if (!hasReachedAlertThreshold(status, threshold)) return null;

  return {
    kind: 'waste_budget_70',
    severity: 'warn',
    title: `${category.name}が予算の${Math.round(threshold * 100)}%に達しました`,
    body: status.remainingYen === null ? null : `残り${formatYen(status.remainingYen)}使えます`,
    dedupKey: `waste_budget_70:${category.id}:${monthKey}`,
    debtId: null,
    transactionId: null,
  };
}

/**
 * NFR-06:ジョブ失敗を知らせる(M3-3 の DoD)。
 *
 * dedup_key は日単位。同じジョブが同じ日に何度失敗しても通知は1件に
 * まとめる(毎時ジョブが同じ原因で連続失敗しても本人の通知が埋もれない
 * ようにする)一方、失敗が翌日にも続いていれば改めて知らせる。
 */
export function buildJobFailureAlert(
  jobName: string,
  errorMessage: string,
  today: DateOnly,
): CandidateAlert {
  return {
    kind: 'job_failure',
    severity: 'critical',
    title: `${jobName}が失敗しました`,
    body: errorMessage,
    dedupKey: `job_failure:${jobName}:${today}`,
    debtId: null,
    transactionId: null,
  };
}
