/**
 * M6:予測を画面に出すときの言葉と数字の丸め。統計用語(信頼区間・分位点・
 * 事後分布など)は使わず、「10回中8回」「おそらく大丈夫」の日常の言葉にする。
 */

/** 確率(0〜1)を「10回中N回」のNにする。 */
export function outOfTen(prob: number): number {
  return Math.max(0, Math.min(10, Math.round(prob * 10)));
}

/** 確率(0〜1)を整数の%にする。 */
export function percent(prob: number): number {
  return Math.max(0, Math.min(100, Math.round(prob * 100)));
}

export type ProbabilityTone = 'ok' | 'caution' | 'over';

/** 予算内に収まる確率の言葉(M6の5段階)。 */
export function probabilityWord(prob: number): { word: string; tone: ProbabilityTone } {
  const p = percent(prob);
  if (p >= 85) return { word: 'ほぼ大丈夫', tone: 'ok' };
  if (p >= 60) return { word: 'おそらく大丈夫', tone: 'ok' };
  if (p >= 40) return { word: '五分五分', tone: 'caution' };
  if (p >= 15) return { word: '厳しめ', tone: 'caution' };
  return { word: 'このままだと超えそう', tone: 'over' };
}

/** 100円単位に丸める。 */
export function round100(yen: number): number {
  return Math.round(yen / 100) * 100;
}

/**
 * 「約4.2万円」「約3,900円」。1万円以上は万円単位(小数1桁)、それ未満は
 * 100円単位。unit=false なら末尾の「円」を付けない(「約4.2万」)。
 */
export function approxYen(yen: number, options: { unit?: boolean; approx?: boolean } = {}): string {
  const unit = options.unit ?? true;
  const prefix = (options.approx ?? true) ? '約' : '';
  const sign = yen < 0 ? '−' : '';
  const abs = Math.abs(round100(yen));
  if (abs >= 10_000) {
    const man = (Math.round(abs / 1000) / 10).toFixed(1);
    return `${prefix}${sign}${man}万${unit ? '円' : ''}`;
  }
  return `${prefix}${sign}${abs.toLocaleString('ja-JP')}${unit ? '円' : ''}`;
}

/** 「3.8万〜4.7万円」(10回中8回の幅)。 */
export function approxRange(lowYen: number, highYen: number): string {
  return `${approxYen(lowYen, { unit: false, approx: false })}〜${approxYen(highYen, { approx: false })}`;
}

/** 収支など符号つき:「+9.7万円」。 */
export function approxSignedYen(yen: number): string {
  const body = approxYen(Math.abs(yen), { approx: false });
  if (round100(yen) === 0) return body;
  return `${yen < 0 ? '−' : '+'}${body}`;
}
