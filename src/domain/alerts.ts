/**
 * 通知の検知ロジック(M3-2)。
 *
 * FR-20(浪費70%到達)と FR-21(リボ/キャッシング/分割)の判定は
 * domain/budget.ts と features/classification/rules.ts に実装済み。
 * ここに置くのは FR-22(未取込・未確認)ほか。FR-23(返済日前日)は借金をなくした
 * (ADR-077)ので外した。
 *
 * ── なぜ純粋関数にするか ────────────────────────────────────
 * 「いつ発火させるか」の判断と、「DB から何を読むか」「DB へどう書くか」を
 * 分離する。判断だけをここに置けば、日付を差し替えるだけで境界値
 * (ちょうど3日目、月末ぴったり)をテストできる。
 *
 * ── dedup_key について ─────────────────────────────────────
 * alerts テーブルは (user_id, dedup_key) が一意(同じ事象を繰り返し
 * 通知しない、設計原則3)。ここで組み立てる dedup_key が、その一意性の
 * 実体になる。
 */

import { hasReachedAlertThreshold, type BudgetStatus } from '@/domain/budget';
import { formatYen } from '@/domain/money';
import type { DetectedSubscription } from '@/domain/subscriptions';
import { daysBetween, formatDateJa, type DateOnly } from '@/lib/date';

/** P6-1 の月次振り返りに載せる、予算設定済みジャンル1件分の消化状況。 */
export type RecapWasteCategory = { name: string; status: BudgetStatus };

export type MonthlyRecapSummary = {
  monthKey: string;
  /** 今月の貯金(収入 − 支出。マイナスもある)。 */
  savedYen: number;
  totalSideIncomeYen: number;
  wasteCategories: readonly RecapWasteCategory[];
};

/** 'payment_due'・'debt_paid_off' は借金をなくした(ADR-077)ので使わない(DB の列挙には残る)。 */
export type AlertKind =
  | 'inactivity'
  | 'payment_due'
  | 'debt_paid_off'
  | 'import_needed'
  | 'revolving_detected'
  | 'cashing_detected'
  | 'installment_detected'
  | 'waste_budget_70'
  | 'job_failure'
  | 'other';
export type AlertSeverity = 'info' | 'warn' | 'critical';

export type CandidateAlert = {
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  body: string | null;
  dedupKey: string;
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
    transactionId: null,
  };
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
    transactionId: transaction.id,
  };
}

/**
 * FR-20:予算を設定したジャンル(genres.budget_yen)が月予算の閾値(既定70%)に
 * 達したら知らせる(ADR-057より前は categories.kind='waste' のカテゴリだけが
 * 対象だったが、category_kind の廃止に伴い「予算を設定した全ジャンル」に
 * 一般化した——本人の提案:「各カテゴリの設定した金額ごとにalertを設定すれば
 * いいのでは?」)。判定そのものは `domain/budget.ts` の
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
    transactionId: null,
  };
}

/**
 * 予算消化ペースが速すぎるか判定する(P5-3)。
 *
 * FR-20(70%到達)は一点の閾値判定だが、月の前半で既にペースが速い
 * カテゴリは、70%に達つ前に気づけた方が判断の余地が残る(設計原則3)。
 * 経過日数に対する消化率(ペース)が、単純な按分(経過日数 ÷ 月の日数)
 * より既定1.5倍以上速ければ「速すぎる」とみなす。
 *
 *   例:月30日のうち9日経過(30%)時点で使用率が50%なら、
 *       ペースは 50% ÷ 30% ≈ 1.67倍 → 閾値(1.5倍)を超える
 *
 * 70%に既に達している場合は `hasReachedAlertThreshold()` 側の責務なので
 * ここでは発火させない(同じ状況で二重に通知しない)。月初の数日は
 * 分母(経過率)が小さく比率が跳ねやすいため、最低経過日数を設ける。
 */
export function isAheadOfPace(
  status: BudgetStatus,
  elapsedDays: number,
  totalDaysInMonth: number,
  options: { paceMultiplier?: number; minElapsedDays?: number } = {},
): boolean {
  const paceMultiplier = options.paceMultiplier ?? 1.5;
  const minElapsedDays = options.minElapsedDays ?? 3;
  if (status.usageRatio === null) return false;
  if (status.usageRatio >= 0.7) return false;
  if (elapsedDays < minElapsedDays || totalDaysInMonth <= 0) return false;

  const elapsedRatio = elapsedDays / totalDaysInMonth;
  if (elapsedRatio <= 0) return false;
  return status.usageRatio / elapsedRatio >= paceMultiplier;
}

/**
 * 予算ペース超過の通知を組み立てる(P5-3)。dedup_key は月単位
 * (`waste_budget_70` と同じ考え方。月が変われば再度知らせてよい)。
 */
export function buildBudgetPaceAlert(
  category: { id: string; name: string },
  status: BudgetStatus,
  monthKey: string,
): CandidateAlert {
  return {
    kind: 'other',
    severity: 'info',
    title: `${category.name}のペースが速めです`,
    body:
      status.remainingYen === null
        ? null
        : `このペースだと、月末までに予算を使い切る可能性があります。残り${formatYen(status.remainingYen)}使えます。`,
    dedupKey: `budget_pace:${category.id}:${monthKey}`,
    transactionId: null,
  };
}

/**
 * 月の最終日か(P6-1)。today と tomorrow(addDays(today, 1))を渡し、
 * 月が変わる日かどうかだけを見る純粋関数にする(31日固定にすると
 * 30日までの月を誤判定するため、「翌日の月」で判定する)。
 */
export function isLastDayOfMonth(today: DateOnly, tomorrow: DateOnly): boolean {
  return today.slice(0, 7) !== tomorrow.slice(0, 7);
}

/**
 * 月次振り返りの通知を組み立てる(P6-1)。月末にだけ送る想定
 * (呼び出し側で isLastDayOfMonth() を見て候補を作るかどうかを決める)。
 *
 * グラフではなくテキストのサマリで十分という判断(TASKS.md P6-1)。
 * 数字を並べるだけにとどめ、多い/少ないの評価は書かない(FR-64 と同じ考え方、
 * 振り返りも「叱らない」対象から外さない)。
 */
export function buildMonthlyRecapAlert(summary: MonthlyRecapSummary): CandidateAlert {
  const [year, month] = summary.monthKey.split('-');
  const lines = [
    `今月の貯金: ${formatYen(summary.savedYen)}`,
    `副業収入: ${formatYen(summary.totalSideIncomeYen)}`,
  ];
  for (const category of summary.wasteCategories) {
    const ratioText =
      category.status.usageRatio === null
        ? '予算なし'
        : `予算の${Math.round(category.status.usageRatio * 100)}%`;
    lines.push(`${category.name}: ${formatYen(category.status.spentYen)}(${ratioText})`);
  }

  return {
    kind: 'other',
    severity: 'info',
    title: `${year}年${Number(month)}月の振り返り`,
    body: lines.join('\n'),
    dedupKey: `monthly_recap:${summary.monthKey}`,
    transactionId: null,
  };
}

/**
 * 新しく検知した定期支払いの通知を組み立てる(本人発案)。
 *
 * dedup_key はグループ(店・金額)単位の固定文字列。一度検知して知らせた
 * サブスクは、以後同じ組み合わせで何度検知しても再通知しない(DB の
 * 一意制約が「初回だけ通知する」を担保する。P5-2 のルール誤爆通知と
 * 同じ考え方)。金額が変われば dedup_key も変わるため、値上げは
 * 「新しいサブスクの検知」として改めて知らせる(これは意図的な仕様:
 * 値上げに気づけることも「浪費の再発防止」の一部)。
 */
export function buildNewSubscriptionAlert(subscription: DetectedSubscription): CandidateAlert {
  return {
    kind: 'other',
    severity: 'info',
    title: `定期支払いを検知しました: ${subscription.label}`,
    body: `${formatYen(subscription.amountYen)}が${subscription.occurrenceCount}ヶ月連続で引き落とされています(前回: ${formatDateJa(subscription.lastOccurredOn)})。忘れているサブスクでなければ、そのままで大丈夫です。`,
    dedupKey: `subscription:${subscription.key}`,
    transactionId: null,
  };
}
