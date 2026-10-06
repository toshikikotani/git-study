/**
 * 確率の見せ方。試行の数には限りがあるので、0%・100% とは言い切らない(「99%以上」「1%未満」)。
 */
export function formatProbability(p: number): string {
  if (p >= 0.995) return '99%以上';
  if (p < 0.005) return '1%未満';
  return `${Math.round(p * 100)}%`;
}

/** 「注意」として目立たせる、目標・予算を超える確率の下限。 */
export const CAUTION_EXCEEDANCE = 0.2;

/**
 * 見込み(予測の金額)の見せ方(設計書 v3 3.9)。幅より細かい数字は出さない:
 * 1万円以上は千円単位で「約17.8万円」、1万円未満は百円単位で「約3,800円」。
 * 使った額・予定のような事実は、これを使わず1円単位のまま出す。
 */
export function formatEstimate(yen: number, options: { approx?: boolean } = {}): string {
  const prefix = options.approx === false ? '' : '約';
  return `${prefix}${estimateBody(yen)}円`;
}

/** 範囲「3.3万〜8.0万円」「1,700〜8,300円」「8,300円〜2.7万円」。 */
export function formatEstimateRange(low: number, high: number): string {
  const lo = estimateBody(low);
  const hi = estimateBody(high);
  const loMan = Math.abs(roundEstimate(low)) >= 10_000;
  const hiMan = Math.abs(roundEstimate(high)) >= 10_000;
  if (loMan === hiMan) return `${lo}〜${hi}円`;
  return `${lo}円〜${hi}円`;
}

/** 符号つき(収支の見込み)。「+9.7万円」「−3,200円」。 */
export function formatSignedEstimate(yen: number): string {
  const rounded = roundEstimate(yen);
  if (rounded === 0) return '±0円';
  return `${rounded < 0 ? '−' : '+'}${estimateBody(Math.abs(yen))}円`;
}

/** 見込みの丸め(1万円以上は千円、未満は百円)。整数の円で返す。 */
export function roundEstimate(yen: number): number {
  const abs = Math.abs(yen);
  const unit = abs >= 9_950 ? 1_000 : 100;
  return Math.sign(yen) * Math.round(abs / unit) * unit;
}

function estimateBody(yen: number): string {
  const rounded = roundEstimate(yen);
  const abs = Math.abs(rounded);
  const sign = rounded < 0 ? '−' : '';
  if (abs >= 10_000) {
    const man = abs / 10_000;
    return `${sign}${man >= 100 ? Math.round(man).toLocaleString('ja-JP') : man.toFixed(1)}万`;
  }
  return `${sign}${abs.toLocaleString('ja-JP')}`;
}

/** 確率を「10回中○回」で言う(設計書 v3 3.9)。%は小さく添える。 */
export function formatTimesInTen(p: number): string {
  const times = Math.min(10, Math.max(0, Math.round(p * 10)));
  if (times === 0) return '10回中1回もない';
  return `10回中${times}回`;
}

/**
 * 見込みを大きく見せるための分割(「約」「17.8」「万円」/「約」「3,800」「円」)。
 * デザインの見出し(数字だけ大きく、単位は小さく)に使う。丸めは formatEstimate と同じ。
 */
export function estimateParts(yen: number): { number: string; unit: string } {
  const body = estimateBody(yen);
  return body.endsWith('万')
    ? { number: body.slice(0, -1), unit: '万円' }
    : { number: body, unit: '円' };
}
