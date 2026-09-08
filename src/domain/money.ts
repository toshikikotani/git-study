/**
 * 金額の扱いを1箇所に閉じ込める。
 *
 * ADR-008:金額はすべて整数の円。日本円に補助単位はなく、明細も1円単位のため
 * 小数を持つ理由がない。浮動小数点を混ぜると丸め誤差が静かに蓄積する。
 *
 * 符号の規約:支出が負、収入が正。集計は SUM だけで済む。
 */

/** 金額として扱える整数の上限。これを超える入力は桁の打ち間違いとみなす。 */
export const MAX_YEN = 1_000_000_000_000; // 1兆円

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** 整数の円であることを検査する。計算結果を DB へ渡す直前に必ず通す。 */
export function assertYen(value: number, label = '金額'): number {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`${label}が数値ではありません: ${value}`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label}は整数の円である必要があります: ${value}`);
  }
  if (Math.abs(value) > MAX_YEN) {
    throw new MoneyError(`${label}が上限を超えています: ${value}`);
  }
  return value;
}

/**
 * 表示用の整形。桁区切りと「円」を付ける。
 * 画面に出る金額は必ずこれを経由させ、書式のゆらぎをなくす。
 */
export function formatYen(value: number, options?: { sign?: 'auto' | 'never' }): string {
  assertYen(value, '表示金額');
  const shown = options?.sign === 'never' ? Math.abs(value) : value;
  return `${shown.toLocaleString('ja-JP')}円`;
}

/**
 * 「あと◯円使える」の肯定形表示(FR-64)。
 * 残額がマイナスでも責めない文言にする(設計原則5)。
 */
export function formatSpendable(remainingYen: number): string {
  assertYen(remainingYen, '残額');
  if (remainingYen >= 0) {
    return `あと${remainingYen.toLocaleString('ja-JP')}円使える`;
  }
  return `予算を${Math.abs(remainingYen).toLocaleString('ja-JP')}円超えている`;
}

/**
 * CSV や入力欄の文字列を円の整数に変換する。
 *
 * 吸収する表記ゆれ(ADR-007):
 *   桁区切りカンマ / 全角数字 / 通貨記号 / 空白 / 括弧によるマイナス表記
 */
export function parseYen(input: string): number {
  const normalized = input
    // 全角の数字・記号を半角へ(コード位置が 0xFEE0 ずれているだけ)
    .replace(/[０-９．，－＋]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[¥￥,\s]/g, '')
    .trim();

  if (normalized === '') {
    throw new MoneyError('金額が空です');
  }

  // 会計表記の (1,234) は -1234
  const parenthesized = /^\((.+)\)$/.exec(normalized);
  const body = parenthesized?.[1] ?? normalized;
  const sign = parenthesized ? -1 : 1;

  if (!/^[+-]?\d+(\.\d+)?$/.test(body)) {
    throw new MoneyError(`金額として解釈できません: ${input}`);
  }

  const value = Number(body);
  if (!Number.isInteger(value)) {
    throw new MoneyError(`円未満の端数は扱えません: ${input}`);
  }

  return assertYen(sign * value);
}

/**
 * 月あたりの利息。年利は小数(15% → 0.15)で受ける(ADR-008)。
 * 円未満は切り捨て。SQL 側の floor(balance * rate / 12) と一致させる。
 */
export function monthlyInterest(balanceYen: number, annualRate: number): number {
  assertYen(balanceYen, '残高');
  if (!Number.isFinite(annualRate) || annualRate < 0 || annualRate > 1) {
    throw new MoneyError(`年利は 0〜1 の小数で指定してください(15% なら 0.15): ${annualRate}`);
  }
  return Math.floor((balanceYen * annualRate) / 12);
}

/** 表示用に年利をパーセントへ。保存は常に小数。 */
export function formatAnnualRate(annualRate: number): string {
  const percent = annualRate * 100;
  return `${Number(percent.toFixed(2))}%`;
}
