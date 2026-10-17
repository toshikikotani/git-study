/**
 * もし今日これだけ使ったら(デザイン v3-2、ADR-108)の、結果の形と、ひとこと。
 * 計算は features/forecast/what-if-spend.ts(ホームと同じ予測)。DBにもネットワークにも触れない
 * (画面とAIの窓口で同じ文を使う)。
 */

import { formatEstimate, formatProbability, formatSignedEstimate } from './format';

export type SpendOutcome = {
  /** 今日これから使う額(いつも通りは 0)。 */
  amountYen: number;
  /** 今期の着地見込み(目標が無ければ null)。 */
  landingYen: number | null;
  /** 目標内に収まる確率(目標が無ければ null)。 */
  probWithinBudget: number | null;
  /** 明日からの1日の目安(目標が無い・今日が最終日なら null)。 */
  tomorrowYen: number | null;
  /** 月末に残る見込み(収入が無ければ null)。 */
  monthEndYen: number | null;
};

export type WhatIfSpend = {
  /** 今期の目標(無ければ null)。 */
  budgetYen: number | null;
  /** 毎月の貯金目標(0 なら決めていない)。 */
  monthlySavingsTargetYen: number;
  base: SpendOutcome;
  options: SpendOutcome[];
  /** 計算した時刻(日本時間、「10/17 12:35」)。 */
  computedAt: string;
};

/** 日本時間の「10/17 12:35」。 */
export function jstClock(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
}

/** 確率が「すでに難しい」とみなす下限(目標内の確率がこれ未満なら、少しの額では見通しは変わらない)。 */
const ALREADY_HARD = 0.05;

/** 試した額で、見通しがどう変わるかのひとこと(責めない。事実と次の目安を書く)。 */
export function whatIfVerdict(result: WhatIfSpend, option: SpendOutcome): string {
  const { base } = result;
  const parts: string[] = [];
  if (base.probWithinBudget !== null && option.probWithinBudget !== null && result.budgetYen) {
    const drop = base.probWithinBudget - option.probWithinBudget;
    if (base.probWithinBudget < ALREADY_HARD) {
      parts.push(
        `今期の目標の${formatEstimate(result.budgetYen, { approx: false })}はすでに難しい状況なので、この額で見通しは大きく変わりません。`,
      );
    } else if (drop >= 0.1) {
      parts.push(
        `目標内の確率が${formatProbability(base.probWithinBudget)}から${formatProbability(option.probWithinBudget)}に下がります。`,
      );
    } else {
      parts.push('この額なら、今期の見通しはほとんど変わりません。');
    }
  }
  if (
    option.tomorrowYen !== null &&
    base.tomorrowYen !== null &&
    option.tomorrowYen < base.tomorrowYen
  ) {
    parts.push(`明日からの目安は1日${formatEstimate(option.tomorrowYen)}になります。`);
  }
  if (result.monthlySavingsTargetYen > 0 && option.monthEndYen !== null) {
    const short = result.monthlySavingsTargetYen - option.monthEndYen;
    parts.push(
      short > 0
        ? `貯金目標まで、月末の見込みであと${formatEstimate(short)}です。`
        : '貯金目標にはまだ届く範囲です。',
    );
  }
  return parts.join('');
}

export type WhatIfRow = { label: string; before: string; after: string };

/** 前 → 後の行(着地見込み・目標内の確率・明日からの目安・月末の貯金)。出せないものは省く。 */
export function whatIfRows(base: SpendOutcome, option: SpendOutcome): WhatIfRow[] {
  const rows: WhatIfRow[] = [];
  if (base.landingYen !== null && option.landingYen !== null) {
    rows.push({
      label: '着地見込み',
      before: formatEstimate(base.landingYen),
      after: formatEstimate(option.landingYen),
    });
  }
  if (base.probWithinBudget !== null && option.probWithinBudget !== null) {
    rows.push({
      label: '目標内の確率',
      before: formatProbability(base.probWithinBudget),
      after: formatProbability(option.probWithinBudget),
    });
  }
  if (base.tomorrowYen !== null && option.tomorrowYen !== null) {
    rows.push({
      label: '明日からの目安',
      before: `${base.tomorrowYen.toLocaleString('ja-JP')}円`,
      after: `${option.tomorrowYen.toLocaleString('ja-JP')}円`,
    });
  }
  if (base.monthEndYen !== null && option.monthEndYen !== null) {
    rows.push({
      label: '月末の貯金',
      before: formatSignedEstimate(base.monthEndYen),
      after: formatSignedEstimate(option.monthEndYen),
    });
  }
  return rows;
}

/** AIの答えに添える「もし使ったら」のカード(simulate_spend、ADR-108)。 */
export type WhatIfCard = {
  amountYen: number;
  genreName: string | null;
  rows: WhatIfRow[];
  verdict: string;
  /** 「10/17 12:35」(アプリの見通しの時点)。 */
  computedAt: string;
};
