/**
 * AIの読み(統計の着地の見込みに、AIが明細のメモ・予定・暦の事情から補正を足す)。
 *
 * AIには計算させない(N1):AIは決まった選択肢から「残りの支出を何%動かすか」を選ぶだけで、
 * 金額はここで計算する。補正は常に100%効かせる。
 */

/** AIが選べる補正(残りの支出に対する%)。 */
export const AI_ADJUST_CHOICES = [-30, -20, -15, -10, -5, 0, 5, 10, 15, 20, 30, 40, 50] as const;
export type AiAdjustPercent = (typeof AI_ADJUST_CHOICES)[number];

export function isAiAdjustPercent(value: number): value is AiAdjustPercent {
  return (AI_ADJUST_CHOICES as readonly number[]).includes(value);
}

/** 過去のAIの読み1回ぶん(月が終わり、実際の着地が分かったもの)。 */
export type ScoredRead = {
  month: string;
  percent: number;
  statP50Yen: number;
  adjustedP50Yen: number;
  actualYen: number;
};

export type AiTrust = {
  /** 補正を効かせる割合(0〜1)。常に1.0。 */
  weight: number;
  /** 統計より近かった回数と、比べた回数(補正0の回は数えない)。 */
  wins: number;
  compared: number;
};

/**
 * 補正は常に100%効かせる。当たり具合による減算はしない。
 */
export function aiTrust(history: readonly ScoredRead[]): AiTrust {
  let wins = 0;
  let compared = 0;
  for (const read of history) {
    if (read.percent === 0 || read.adjustedP50Yen === read.statP50Yen) continue;
    compared += 1;
    if (
      Math.abs(read.adjustedP50Yen - read.actualYen) < Math.abs(read.statP50Yen - read.actualYen)
    ) {
      wins += 1;
    }
  }
  // 常に100%効かせる
  return { weight: 1, wins, compared };
}

/** 残りの部分(着地 − 決まっている額)だけを動かす。金額は整数の円。 */
export function applyAiRead(input: {
  knownYen: number;
  band: { p10: number; p50: number; p90: number };
  percent: number;
  weight: number;
}): { p10: number; p50: number; p90: number; effectivePercent: number } {
  const factor = 1 + (input.percent * input.weight) / 100;
  const shift = (value: number) =>
    Math.max(0, Math.round(input.knownYen + Math.max(0, value - input.knownYen) * factor));
  return {
    p10: shift(input.band.p10),
    p50: shift(input.band.p50),
    p90: shift(input.band.p90),
    effectivePercent: Math.round(input.percent * input.weight * 10) / 10,
  };
}
