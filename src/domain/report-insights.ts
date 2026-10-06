/**
 * レポートの気づき(原因と次の一手)。数字から決まる文だけで、AIは使わない。
 * 叱らず、事実→次の一手の順に短く書く(docs/WRITING.md)。数字には単位と期間を添える。
 */

import {
  CAUTION_EXCEEDANCE,
  formatEstimate,
  formatProbability,
  formatTimesInTen,
} from '@/domain/forecast/format';
import type { Forecast } from '@/domain/forecast/types';

export type Insight = {
  key: string;
  /** caution は「注意して見てほしい」、info は事実の共有。 */
  tone: 'info' | 'caution';
  text: string;
};

const yen = (n: number) => `${Math.round(n).toLocaleString('ja-JP')}円`;
/** 見込みの額(1万円以上は千円、未満は百円単位。設計書 v3 3.9)。事実の額は yen() のまま。 */
const est = (n: number) => formatEstimate(n, { approx: false });

/** ジャンルが「先より増える」と言う最小の増加額と割合。 */
const MIN_INCREASE_YEN = 3000;
const MIN_INCREASE_RATIO = 0.15;
const MAX_INSIGHTS = 6;

export function reportInsights(input: {
  forecast: Forecast;
  /** 目標の総予算(無ければ null)。 */
  budgetYen: number | null;
  /** 期間の呼び名(「今月」「この目標の期間」)。 */
  periodLabel: string;
  /** 比べる直前の期間の、ジャンルごとの支出(正の円)。無ければ比べない。 */
  previousByGenre?: ReadonlyMap<string, number>;
  previousLabel?: string;
}): Insight[] {
  const { forecast, budgetYen } = input;
  const out: Insight[] = [];

  if (forecast.status === 'learning') {
    out.push({
      key: 'learning',
      tone: 'info',
      text: `記録が${forecast.dataDays}日ぶんなので、着地の幅は広めに出している。記録が2週間たまるとしぼれる。`,
    });
  }

  // 予算に収まる確率と、次の一手(1日の上限)。
  if (budgetYen !== null && forecast.probWithinBudget !== null) {
    const within = forecast.probWithinBudget;
    const pct = `${formatTimesInTen(within)}(${formatProbability(within)})`;
    if (1 - within < CAUTION_EXCEEDANCE) {
      out.push({
        key: 'budget',
        tone: 'info',
        text: `予算 ${yen(budgetYen)} に収まるのは${pct}。このペースで足りる。`,
      });
    } else {
      const allowance =
        forecast.safeDailyAllowance !== null && forecast.remainingDays > 0
          ? `残り${forecast.remainingDays}日を1日 約${est(forecast.safeDailyAllowance)} までにすると、収まるのが10回中8回になる。`
          : '';
      out.push({
        key: 'budget',
        tone: 'caution',
        text: `予算 ${yen(budgetYen)} に収まるのは${pct}。超えるときは平均で 約${est(forecast.expectedOvershoot)} 超える。${allowance}`,
      });
    }
  }

  // 先と比べて増える見込みのジャンル(理由は数字で示す)。
  if (input.previousByGenre !== undefined) {
    const label = input.previousLabel ?? '前の期間';
    const increases = forecast.byCategory
      .map((c) => {
        const before = input.previousByGenre!.get(c.categoryId) ?? 0;
        return { c, before, diff: c.landing.p50 - before };
      })
      .filter(
        (x) =>
          x.before > 0 && x.diff >= MIN_INCREASE_YEN && x.diff / x.before >= MIN_INCREASE_RATIO,
      )
      .sort((a, b) => b.diff - a.diff);
    const top = increases[0];
    if (top) {
      out.push({
        key: 'increase',
        tone: 'info',
        text: `${top.c.categoryName}は${label}より 約${est(top.diff)} 増える見込み(${yen(top.before)} → 約${est(top.c.landing.p50)})。ここを1回減らすのが、いちばん効く。`,
      });
    }
  }

  // 超える場合の主な原因。
  const driver = forecast.drivers[0];
  if (driver && driver.shareOfRisk >= 0.4 && budgetYen !== null) {
    out.push({
      key: 'driver',
      tone: 'info',
      text: `予算を超える場合の原因の${Math.round(driver.shareOfRisk * 100)}%は${driver.categoryName}。`,
    });
  }

  // すでに決まっている額。
  const committed = forecast.committed.scheduledYen + forecast.committed.fixedYen;
  if (committed > 0 && forecast.total.p50 > 0) {
    const share = Math.round((committed / forecast.total.p50) * 100);
    out.push({
      key: 'committed',
      tone: 'info',
      text: `${input.periodLabel}は、予定と固定費で ${yen(committed)} がもう決まっている(着地の${share}%)。自由に動かせるのは残りの部分。`,
    });
  }

  // 規則的に通う店。
  const regular = [...forecast.visits.merchants].sort((a, b) => b.meanYen - a.meanYen)[0];
  if (regular && forecast.visits.expectedYen > 0) {
    out.push({
      key: 'visits',
      tone: 'info',
      text: `${regular.label}には約${regular.everyDays}日おきに通っていて、1回およそ ${est(regular.meanYen)}。残りの期間の規則的な来店の見込みは合計 約${est(forecast.visits.expectedYen)}。`,
    });
  }

  // 季節。
  const factor = forecast.seasonal.periodFactor;
  if (forecast.seasonal.active && factor !== null && Math.abs(factor - 1) >= 0.08) {
    const pct = Math.round(Math.abs(factor - 1) * 100);
    out.push({
      key: 'season',
      tone: 'info',
      text:
        factor > 1
          ? `この時期は例年、支出が平年より${pct}%多い。着地にはその分を入れてある。`
          : `この時期は例年、支出が平年より${pct}%少ない。着地にはその分を入れてある。`,
    });
  }

  // まだ記録されていない支出(記録の遅れ)と、月払いの請求。
  if (forecast.unrecordedYen >= 1000) {
    out.push({
      key: 'unrecorded',
      tone: 'info',
      text: `いつもの記録のタイミングから、まだ記録されていない支出を約${est(forecast.unrecordedYen)}見込んでいる。記録すると、この分は実績に変わる。`,
    });
  }
  const bill = [...forecast.bills.items].sort((a, b) => b.meanYen - a.meanYen)[0];
  if (bill && forecast.bills.expectedYen > 0) {
    out.push({
      key: 'bills',
      tone: 'info',
      text: `${bill.label}など毎月の請求を、残りの期間に約${est(forecast.bills.expectedYen)}見込んでいる。`,
    });
  }

  // 検証の結果、中心を動かしているとき(残りの支出が予測より系統的に多かった・少なかった)。
  const center = forecast.calibration?.centerByPhase[forecast.phase] ?? 1;
  if (Math.abs(center - 1) >= 0.05) {
    const pct = Math.round(Math.abs(center - 1) * 100);
    out.push({
      key: 'center',
      tone: 'info',
      text:
        center > 1
          ? `過去の月の同じ時期では、残りの支出が予測より${pct}%ほど多かった。その分を上乗せして出している。`
          : `過去の月の同じ時期では、残りの支出が予測より${pct}%ほど少なかった。その分を下げて出している。`,
    });
  }

  // 検証できた月が少ないときは、数字が目安であることを伝える。
  if (forecast.provisional && forecast.status !== 'learning') {
    out.push({
      key: 'provisional',
      tone: 'info',
      text: '過去の月で確かめられたのが3か月未満なので、幅と確率は目安。月がたまるほど、本人の記録に合わせて直る。',
    });
  }

  return out.slice(0, MAX_INSIGHTS);
}

/**
 * 「なぜこの見込み?」の一文の理由(設計書 v3 3.5)。残りの1日あたりの見込みと、直近14日の
 * 1日あたりを並べる。見込みが直近よりかなり低いときは、多くなりやすいと添える。
 */
export function paceReason(forecast: Forecast): Insight | null {
  const pace = forecast.pace;
  if (pace.perDayYen === null || forecast.remainingDays <= 0 || pace.remainingYen <= 0) return null;
  const recent = pace.recentPerDayYen;
  const lower = recent !== null && recent > 0 && pace.perDayYen < recent * 0.7;
  return {
    key: 'pace',
    tone: lower ? 'caution' : 'info',
    text:
      (recent !== null ? `直近14日は1日 約${est(recent)}。` : '') +
      `この先の見込みは1日 約${est(pace.perDayYen)}(残り${forecast.remainingDays}日で 約${est(pace.remainingYen)})。` +
      (lower
        ? '見込みは直近のペースより低い。まとまった支払いが続いていたなら、多くなりやすい。'
        : ''),
  };
}
