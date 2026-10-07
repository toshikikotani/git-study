/**
 * 貯金と貯金目標(借金に代わる、アプリの中心の考え方。ADR-080)。
 *
 * 貯まった額は「収入 − 支出」から自動で数える(本人の選択)。口座の残高や手入力は使わない。
 *   - 月ごとの貯金 = その月の収入 − その月の支出(今日までの実績だけ。予定は数えない。
 *     振替・対象外は数えない。返金は支出から差し引く。家計簿と同じ数え方)。
 *   - 貯金の合計 = 貯金を数え始めた日(進行中の目標のうち、いちばん早い開始日)からの累計。
 *     使いすぎた月はマイナスになり、合計から減る。合計がマイナスのときは 0 とみなす。
 *   - 目標への割り当て:合計を、期限の近い目標から順に満たす(期限の無い目標は最後、
 *     同じなら作った順)。1つの貯金を複数の目標で二重に数えない。
 */

import { addMonths, nthDayOfMonth, type DateOnly } from '@/lib/date';

export type SavingsTransaction = {
  occurredOn: DateOnly;
  amountYen: number;
  isTransfer: boolean;
  reviewStatus: string;
  kind?: 'normal' | 'special' | 'refund' | undefined;
};

export type MonthlySavings = {
  /** 'YYYY-MM' */
  monthKey: string;
  incomeYen: number;
  spendingYen: number;
  /** 収入 − 支出(マイナスもある)。 */
  savedYen: number;
};

function isCountable(t: SavingsTransaction): boolean {
  return !t.isTransfer && t.reviewStatus !== 'ignored' && t.amountYen !== 0;
}

/** 期間(from〜today)の月ごとの収入・支出・貯金。今日より先の明細は数えない。 */
export function monthlySavings(
  transactions: readonly SavingsTransaction[],
  from: DateOnly,
  today: DateOnly,
): MonthlySavings[] {
  const byMonth = new Map<string, { income: number; spending: number }>();
  for (let m = nthDayOfMonth(from, 1); m <= today; m = addMonths(m, 1)) {
    byMonth.set(m.slice(0, 7), { income: 0, spending: 0 });
  }
  for (const t of transactions) {
    if (!isCountable(t) || t.occurredOn < from || t.occurredOn > today) continue;
    const acc = byMonth.get(t.occurredOn.slice(0, 7));
    if (!acc) continue;
    if (t.kind === 'refund') acc.spending -= t.amountYen;
    else if (t.amountYen > 0) acc.income += t.amountYen;
    else acc.spending += -t.amountYen;
  }
  return [...byMonth.entries()].map(([monthKey, v]) => ({
    monthKey,
    incomeYen: v.income,
    spendingYen: v.spending,
    savedYen: v.income - v.spending,
  }));
}

/** 貯金の合計(マイナスなら 0)。 */
export function savingsTotal(months: readonly MonthlySavings[]): number {
  return Math.max(
    0,
    months.reduce((sum, m) => sum + m.savedYen, 0),
  );
}

export type SavingsGoalInput = {
  id: string;
  title: string;
  targetAmountYen: number | null;
  targetDate: DateOnly | null;
  startOn: DateOnly;
  createdAt: string;
};

export type SavingsGoalProgress<G extends SavingsGoalInput = SavingsGoalInput> = {
  goal: G;
  /** この目標に割り当てた貯金。 */
  savedYen: number;
  /** 目標まであと(金額の無い目標は null)。 */
  remainingYen: number | null;
  /** 期限までの月数(今月を含む。期限が無い・過ぎたなら null)。 */
  monthsLeft: number | null;
  /** 期限に間に合わせるのに要る、毎月の貯金(金額・期限のどちらかが無ければ null)。 */
  monthlyNeededYen: number | null;
  /** いつものペース(直近の月の貯金の平均)で続けたときに、届く月('YYYY-MM')。届かなければ null。 */
  reachMonth: string | null;
  /** 貯まった(割り当てが目標以上)。 */
  reached: boolean;
};

/** 期限の近い順(期限の無い目標は最後、同じなら作った順)。 */
export function orderGoals<G extends SavingsGoalInput>(goals: readonly G[]): G[] {
  return [...goals].sort((a, b) => {
    if (a.targetDate !== b.targetDate) {
      if (a.targetDate === null) return 1;
      if (b.targetDate === null) return -1;
      return a.targetDate.localeCompare(b.targetDate);
    }
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/** 貯金を数え始める日:進行中の目標のうち、いちばん早い開始日。目標が無ければ null。 */
export function savingsStartOf(goals: readonly SavingsGoalInput[]): DateOnly | null {
  if (goals.length === 0) return null;
  return goals.reduce((min, g) => (g.startOn < min ? g.startOn : min), goals[0]!.startOn);
}

/** 直近の完了した月(最大3か月)の貯金の平均。完了した月が無ければ null。 */
export function recentMonthlySavings(
  months: readonly MonthlySavings[],
  today: DateOnly,
): number | null {
  const thisMonth = today.slice(0, 7);
  const done = months.filter((m) => m.monthKey < thisMonth).slice(-3);
  if (done.length === 0) return null;
  return Math.round(done.reduce((sum, m) => sum + m.savedYen, 0) / done.length);
}

/**
 * 貯金の合計を、期限の近い目標から順に割り当て、目標ごとの残り・毎月要る額・届く見込みを出す。
 * pace は「いつものペース」(1か月の貯金。recentMonthlySavings)。null なら届く見込みは出さない。
 */
export function allocateSavings<G extends SavingsGoalInput>(input: {
  goals: readonly G[];
  totalYen: number;
  pace: number | null;
  today: DateOnly;
}): SavingsGoalProgress<G>[] {
  let left = Math.max(0, input.totalYen);
  // 前の目標に届くまでにかかる貯金(届く月を、順番どおりに積み上げて数えるため)。
  let queuedYen = 0;
  return orderGoals(input.goals).map((goal) => {
    const target = goal.targetAmountYen;
    const saved = target === null ? left : Math.min(left, target);
    left -= target === null ? left : saved;
    const remaining = target === null ? null : Math.max(0, target - saved);
    const monthsLeft =
      goal.targetDate !== null && goal.targetDate >= input.today
        ? monthsBetweenInclusive(input.today, goal.targetDate)
        : null;
    const monthlyNeeded =
      remaining !== null && monthsLeft !== null ? Math.ceil(remaining / monthsLeft) : null;
    queuedYen += remaining ?? 0;
    const reachMonth =
      remaining === null
        ? null
        : remaining === 0
          ? input.today.slice(0, 7)
          : input.pace !== null && input.pace > 0
            ? addMonths(nthDayOfMonth(input.today, 1), Math.ceil(queuedYen / input.pace) - 1).slice(
                0,
                7,
              )
            : null;
    return {
      goal,
      savedYen: saved,
      remainingYen: remaining,
      monthsLeft,
      monthlyNeededYen: monthlyNeeded,
      reachMonth,
      reached: remaining === 0,
    };
  });
}

/** today の月から until の月まで(両端を含む)の月数。 */
export function monthsBetweenInclusive(today: DateOnly, until: DateOnly): number {
  const [ty, tm] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const [uy, um] = [Number(until.slice(0, 4)), Number(until.slice(5, 7))];
  return Math.max(1, (uy - ty) * 12 + (um - tm) + 1);
}

/**
 * 毎月これだけ多く貯めると、届く月がどれだけ早まるか(ちりつも:小口の支出を減らしたら)。
 * 残りと、いつものペース(1か月)から、月数の差を出す。ペースが無い・0以下なら null。
 */
export function monthsSoonerWith(input: {
  remainingYen: number;
  pace: number | null;
  extraPerMonthYen: number;
}): number | null {
  if (input.pace === null || input.pace <= 0 || input.remainingYen <= 0) return null;
  const before = Math.ceil(input.remainingYen / input.pace);
  const after = Math.ceil(input.remainingYen / (input.pace + Math.max(0, input.extraPerMonthYen)));
  return before - after;
}

/** 届く月の表示('2027-03' → 今年なら「3月」、それ以外は「2027年3月」)。 */
export function formatReachMonth(monthKey: string, today: DateOnly): string {
  const month = `${Number(monthKey.slice(5, 7))}月`;
  return monthKey.slice(0, 4) === today.slice(0, 4) ? month : `${monthKey.slice(0, 4)}年${month}`;
}

/** 目標1件の、ひとことの見通し(ホーム・貯金画面・朝のブリーフで同じ言い方にする)。 */
export function goalOutlook(progress: SavingsGoalProgress, today: DateOnly): string {
  if (progress.reached) return '貯まりました';
  if (progress.remainingYen === null) return 'いくらでも、貯まったぶんだけ';
  const parts: string[] = [];
  if (progress.monthlyNeededYen !== null) {
    parts.push(`期限まで毎月 ${progress.monthlyNeededYen.toLocaleString('ja-JP')}円`);
  }
  if (progress.reachMonth !== null) {
    parts.push(`いまのペースなら${formatReachMonth(progress.reachMonth, today)}に届く`);
  } else {
    parts.push('いまのペースでは、まだ届く見込みがありません');
  }
  return parts.join('・');
}

/** 次に目指す目標(まだ貯まっていない、いちばん期限の近いもの。全部貯まっていれば先頭)。 */
export function nextGoal<G extends SavingsGoalInput>(
  goals: readonly SavingsGoalProgress<G>[],
): SavingsGoalProgress<G> | null {
  return goals.find((g) => !g.reached) ?? goals[0] ?? null;
}

/** 次の目標の進み具合(0〜1)。金額の無い目標・目標が無いときは null。 */
export function nextGoalRatio(goals: readonly SavingsGoalProgress[]): number | null {
  const next = nextGoal(goals);
  const target = next?.goal.targetAmountYen ?? null;
  if (next === null || target === null) return null;
  return Math.min(1, next.savedYen / target);
}

/** 朝のブリーフの見出し(ホームの貯金カードと同じ数字)。 */
export function savingsHeadline(summary: {
  totalYen: number;
  thisMonthYen: number;
  goals: readonly SavingsGoalProgress[];
}): string {
  const yen = (value: number) => `${value.toLocaleString('ja-JP')}円`;
  const next = nextGoal(summary.goals);
  if (next === null) {
    const sign = summary.thisMonthYen < 0 ? '−' : '';
    return `今月の貯金 ${sign}${yen(Math.abs(summary.thisMonthYen))}`;
  }
  const rest =
    next.remainingYen !== null && next.remainingYen > 0
      ? `・${next.goal.title}まであと${yen(next.remainingYen)}`
      : next.reached
        ? `・${next.goal.title}は貯まりました`
        : '';
  return `貯金 ${yen(summary.totalYen)}${rest}`;
}
