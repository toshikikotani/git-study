/**
 * レポートの気づき(原因と次の一手)。数字から決まる文だけで、AIは使わない。
 * 叱らず、事実→次の一手の順に短く書く(docs/WRITING.md)。数字には単位と期間を添える。
 */

import type { Forecast } from '@/domain/forecast/types';

export type Insight = {
  key: string;
  /** caution は「注意して見てほしい」、info は事実の共有。 */
  tone: 'info' | 'caution';
  text: string;
};

const yen = (n: number) => `${Math.round(n).toLocaleString('ja-JP')}円`;
const round100 = (n: number) => Math.round(n / 100) * 100;

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
    const pct = Math.round(forecast.probWithinBudget * 100);
    if (pct >= 80) {
      out.push({
        key: 'budget',
        tone: 'info',
        text: `予算 ${yen(budgetYen)} に収まる確率は${pct}%。このペースで足りる。`,
      });
    } else {
      const allowance =
        forecast.safeDailyAllowance !== null && forecast.remainingDays > 0
          ? `残り${forecast.remainingDays}日を1日 ${yen(round100(forecast.safeDailyAllowance))} までにすると、収まる確率が80%になる。`
          : '';
      out.push({
        key: 'budget',
        tone: 'caution',
        text: `予算 ${yen(budgetYen)} に収まる確率は${pct}%。超えるときは平均で ${yen(round100(forecast.expectedOvershoot))} 超える。${allowance}`,
      });
    }
  }

  // 残りの見込みが妥当か確かめられるように、1日あたりと直近のペースを並べる。
  const pace = forecast.pace;
  if (pace.perDayYen !== null && forecast.remainingDays > 0 && pace.remainingYen > 0) {
    const recent = pace.recentPerDayYen;
    const lower = recent !== null && recent > 0 && pace.perDayYen < recent * 0.7;
    out.push({
      key: 'pace',
      tone: lower ? 'caution' : 'info',
      text:
        `残り${forecast.remainingDays}日は、平均で約${yen(round100(pace.remainingYen))}(1日あたり約${yen(round100(pace.perDayYen))})を見込んでいる。` +
        (recent !== null ? `直近14日の1日あたりは約${yen(round100(recent))}。` : '') +
        (lower
          ? '見込みは直近のペースより低い。まとまった支払いが続いていたなら、上振れしやすい。'
          : ''),
    });
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
        text: `${top.c.categoryName}は${label}より ${yen(round100(top.diff))} 増える見込み(${yen(round100(top.before))} → ${yen(round100(top.c.landing.p50))})。ここを1回減らすのが、いちばん効く。`,
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
      text: `${regular.label}には約${regular.everyDays}日おきに通っていて、1回およそ ${yen(round100(regular.meanYen))}。残りの期間の規則的な来店の見込みは合計 ${yen(round100(forecast.visits.expectedYen))}。`,
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

  // 検証の結果、中心を動かしているとき(残りの支出が予測より系統的に多かった・少なかった)。
  const center = forecast.calibration?.centerFactor ?? 1;
  if (Math.abs(center - 1) >= 0.05) {
    const pct = Math.round(Math.abs(center - 1) * 100);
    out.push({
      key: 'center',
      tone: 'info',
      text:
        center > 1
          ? `過去の月では、残りの支出が予測より${pct}%ほど多かった。その分を上乗せして出している。`
          : `過去の月では、残りの支出が予測より${pct}%ほど少なかった。その分を下げて出している。`,
    });
  }

  // 検証の結果、帯を広げているとき。
  if (forecast.calibration !== null && forecast.calibration.widthFactor >= 1.2) {
    out.push({
      key: 'calibration',
      tone: 'info',
      text: `過去の月では、着地が幅の外に出ることが多かったので、幅を${forecast.calibration.widthFactor.toFixed(1)}倍に広げて出している。`,
    });
  }

  return out.slice(0, MAX_INSIGHTS);
}
