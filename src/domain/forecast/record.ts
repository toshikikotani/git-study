/**
 * 記録の続き具合と収入(純粋関数)。予測の読み込み(features/forecast/load.ts)と評価
 * (scripts/forecast-eval)の両方から使う。
 */

import { daysBetween, type DateOnly } from '@/lib/date';
import type { ForecastSourceTransaction } from './decompose';

/** 記録の空白がこの日数を超えたら、そこから先を「記録が続いている期間」とみなす。 */
const RECORD_GAP_DAYS = 21;
/** 給料の中央値を取る、直近の月の数。 */
const SALARY_MONTHS = 3;

/**
 * 記録が続いている最初の日。昔に少しだけ記録して、しばらく空いてから使い始めた人だと、
 * いちばん古い記録の日から数えると記録の無い日まで「支出0円の日」として学習してしまい、
 * 見込みが低く出る。最新から遡って、RECORD_GAP_DAYS を超える空白があればその後から数える。
 */
export function continuousRecordStart(
  transactions: readonly ForecastSourceTransaction[],
  today: DateOnly,
): DateOnly | null {
  const dates = [
    ...new Set(
      transactions.filter((t) => t.amountYen < 0 && t.occurredOn <= today).map((t) => t.occurredOn),
    ),
  ].sort();
  if (dates.length === 0) return null;
  for (let i = dates.length - 1; i > 0; i -= 1) {
    if (daysBetween(dates[i - 1]!, dates[i]!) > RECORD_GAP_DAYS) return dates[i]!;
  }
  return dates[0]!;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function isIncome(t: ForecastSourceTransaction): boolean {
  return t.amountYen > 0 && t.kind !== 'refund' && !t.isTransfer && t.reviewStatus !== 'ignored';
}

/**
 * 期間の収入。手取りの設定(無ければ直近3か月の給料=その月のいちばん大きい収入の中央値)を
 * 給料の見込みとし、期間に記録・予定された収入に給料らしいもの(見込みの半分以上)が無ければ足す。
 * 給料以外の収入は、記録・予定されたものだけを数える(見込まない)。
 */
export function periodIncome(input: {
  transactions: readonly ForecastSourceTransaction[];
  period: { from: DateOnly; to: DateOnly };
  takeHomeYen: number | null;
}): { yen: number; source: 'setting' | 'salary' } | null {
  const { period } = input;
  const largestByMonth = new Map<string, number>();
  for (const t of input.transactions) {
    if (!isIncome(t) || t.occurredOn >= period.from) continue;
    const key = t.occurredOn.slice(0, 7);
    largestByMonth.set(key, Math.max(largestByMonth.get(key) ?? 0, t.amountYen));
  }
  const recentSalaries = [...largestByMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, SALARY_MONTHS)
    .map(([, yen]) => yen);
  const setting = input.takeHomeYen !== null && input.takeHomeYen > 0 ? input.takeHomeYen : null;
  const salary = setting ?? median(recentSalaries);
  if (salary === null) return null;
  const inPeriod = input.transactions.filter(
    (t) => isIncome(t) && t.occurredOn >= period.from && t.occurredOn <= period.to,
  );
  const known = inPeriod.reduce((sum, t) => sum + t.amountYen, 0);
  const salaryArrived = inPeriod.some((t) => t.amountYen >= salary / 2);
  return {
    yen: Math.round(salaryArrived ? known : known + salary),
    source: setting !== null ? 'setting' : 'salary',
  };
}
