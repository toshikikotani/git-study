/**
 * AIの自由文出力に含まれる数値を、渡した事実(facts)と突き合わせる(N1本人要件)。
 *
 * 「AIに計算をさせない。集計関数で計算した『事実』をAIに渡し、AIは文章だけを
 * 書く。AIの出力に含まれる数値をすべて抽出し、渡した事実の中に存在するか
 * 検証する。存在しない数値があれば、その出力を破棄して代替表示にする。」
 *
 * ── facts に何を入れるべきか ──────────────────────────────────
 * 最も安全なのは、AIへ実際に送った本文(system・user メッセージ)に登場する
 * すべての数値をそのまま facts として渡すこと(モデルが見た数字をそのまま
 * 引用しているだけなら必ず一致する)。呼び出し側で個別に計算した派生値
 * (割合・差分など)も、AI に見せた時点で本文に書かれているはずなので、
 * 同じ facts に含まれる。
 *
 * ── 小さい数値は素通しする ──────────────────────────────────
 * 「今月の外食は平均の2倍」のような比率・倍率・件数の言い回しは、本文には
 * 現れない新しい小さな整数を生む(2倍・3件など)。これらまで厳密に facts と
 * 突き合わせると、正当な言い回しまで大量に弾いてしまう。ALLOW_BELOW 未満の
 * 整数は無条件に許可する(単位・年など、金額の桁と混同しない範囲)。
 */

/** この値未満の数値は常に許可する(倍率・件数などの小さな数字)。 */
export const DEFAULT_ALLOW_BELOW = 13;

/** 「同じ」とみなす誤差(丸め表示・小数の揺れを吸収する)。 */
export const DEFAULT_TOLERANCE = 0.5;

const NUMBER_PATTERN = /\d+(?:\.\d+)?/g;

/** 文字列中の数値をすべて抽出する(桁区切りのカンマは数値の一部として読む)。 */
export function extractNumbers(text: string): number[] {
  const withoutThousandsCommas = text.replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1');
  const matches = withoutThousandsCommas.match(NUMBER_PATTERN) ?? [];
  return matches.map(Number).filter((n) => Number.isFinite(n));
}

export type NumericVerificationViolation = { text: string; numbers: number[] };

export type NumericVerificationResult = {
  ok: boolean;
  violations: NumericVerificationViolation[];
};

/**
 * texts の各要素に含まれる数値(ALLOW_BELOW 以上のもの)が、すべて facts の
 * いずれかと誤差 tolerance 以内で一致するかを見る。1件でも一致しない数値を
 * 含む文字列があれば violations に積む(ok は全体が問題無いときだけ true)。
 */
export function verifyNumbersAgainstFacts(
  texts: readonly string[],
  facts: readonly number[],
  options?: { tolerance?: number; allowBelow?: number },
): NumericVerificationResult {
  const tolerance = options?.tolerance ?? DEFAULT_TOLERANCE;
  const allowBelow = options?.allowBelow ?? DEFAULT_ALLOW_BELOW;
  const violations: NumericVerificationViolation[] = [];

  for (const text of texts) {
    const numbers = extractNumbers(text).filter((n) => n >= allowBelow);
    const unknown = numbers.filter((n) => !facts.some((f) => Math.abs(f - n) <= tolerance));
    if (unknown.length > 0) violations.push({ text, numbers: unknown });
  }

  return { ok: violations.length === 0, violations };
}
