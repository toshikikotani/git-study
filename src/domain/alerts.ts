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

import { addDays, addMonthsToParts, daysBetween, splitDateOnly, type DateOnly } from '@/lib/date';

export type AlertKind =
  | 'inactivity'
  | 'payment_due'
  | 'debt_paid_off'
  | 'import_needed'
  | 'revolving_detected'
  | 'cashing_detected'
  | 'installment_detected';
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
