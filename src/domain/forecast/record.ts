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
 * 賞与(設計書 v3 4.9):去年・おととしの同じ月に、給料より給料の半分以上多い収入があった月は、
 * その多かった分(新しい年の値)を賞与として見込む。期間にもう同じくらいの収入が入っていれば足さない。
 * そのほかの給料以外の収入は、記録・予定されたものだけを数える(見込まない)。
 */
export function periodIncome(input: {
  transactions: readonly ForecastSourceTransaction[];
  period: { from: DateOnly; to: DateOnly };
  takeHomeYen: number | null;
}): { yen: number; source: 'setting' | 'salary'; bonusYen: number } | null {
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
  const bonus = expectedBonus(input.transactions, period.from, salary);
  // 賞与を見込む月は、給料の0.5〜1.5倍の収入だけを給料とみなす(賞与を給料と取り違えない)。
  const salaryArrived = inPeriod.some(
    (t) => t.amountYen >= salary / 2 && (bonus === 0 || t.amountYen <= salary * 1.5),
  );
  // 期間の収入が、給料のほかに賞与の半分以上もう入っていれば、賞与は来たとみなす。
  const extraArrived = known - (salaryArrived ? salary : 0) >= bonus / 2;
  const bonusYen = bonus > 0 && !extraArrived ? bonus : 0;
  return {
    yen: Math.round((salaryArrived ? known : known + salary) + bonusYen),
    source: setting !== null ? 'setting' : 'salary',
    bonusYen: Math.round(bonusYen),
  };
}

/** 去年・おととしの同じ月の、給料を超えた分(給料の半分以上のときだけ)。新しい年を優先する。 */
function expectedBonus(
  transactions: readonly ForecastSourceTransaction[],
  periodFrom: DateOnly,
  salary: number,
): number {
  const month = periodFrom.slice(5, 7);
  const year = Number(periodFrom.slice(0, 4));
  for (const y of [year - 1, year - 2]) {
    const key = `${y}-${month}`;
    const total = transactions
      .filter((t) => isIncome(t) && t.occurredOn.slice(0, 7) === key)
      .reduce((sum, t) => sum + t.amountYen, 0);
    const excess = total - salary;
    if (total > 0 && excess >= salary / 2) return excess;
    if (total > 0) return 0;
  }
  return 0;
}
