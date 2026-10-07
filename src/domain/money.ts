/**
 * 金額の扱いを1箇所に閉じ込める。
 *
 * ADR-008:金額はすべて整数の円。日本円に補助単位はなく、明細も1円単位のため
 * 小数を持つ理由がない。浮動小数点を混ぜると丸め誤差が静かに蓄積する。
 *
 * 符号の規約:支出が負、収入が正。集計は SUM だけで済む。
 */

import { AppError } from '@/lib/errors';

/** 金額として扱える整数の上限。これを超える入力は桁の打ち間違いとみなす。 */
export const MAX_YEN = 1_000_000_000_000; // 1兆円

export class MoneyError extends AppError {}

/** 金額のマイナス記号(U+2212)。 */
export const MINUS = '\u2212';

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
  // マイナスは U+2212(−)。ハイフン(-)は数字と並ぶと短く、金額の符号として読みにくい。
  return `${shown.toLocaleString('ja-JP').replace('-', MINUS)}円`;
}

/**
 * 「あと◯円使える」の肯定形表示(FR-64)。
 * 残額がマイナスでも責めない文言にする(設計原則5)。
 */
export function formatSpendable(remainingYen: number): string {
  const { prefix, amount, suffix } = spendableParts(remainingYen);
  return `${prefix}${amount}${suffix}`;
}

/**
 * 同じ文言を、金額とそれ以外に分けて返す。
 *
 * 画面では金額だけを大きく組みたい。文字列を組み立ててから分解し直すと
 * 文言の変更に追従できないため、分割はここで一度だけ行う。
 * 文言そのものは formatSpendable と共通で、二重管理にならない。
 */
export function spendableParts(remainingYen: number): {
  prefix: string;
  amount: string;
  suffix: string;
} {
  assertYen(remainingYen, '残額');
  if (remainingYen >= 0) {
    return {
      prefix: 'あと',
      amount: `${remainingYen.toLocaleString('ja-JP')}円`,
      suffix: '使える',
    };
  }
  return {
    prefix: '予算を',
    amount: `${Math.abs(remainingYen).toLocaleString('ja-JP')}円`,
    suffix: '超えている',
  };
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

export type TaxRoundingMode = 'floor' | 'round' | 'ceil';

/**
 * 税抜金額を税込に換算する(N2本人要件「税込8%/税込10%ボタン」)。
 * 端数処理は切り捨て(floor)を既定にする——本人要件どおり、呼び出し側が
 * 設定で切り上げ・四捨五入に変えられるよう rounding を渡せるようにしてある。
 */
export function toTaxIncluded(
  exclusiveYen: number,
  ratePercent: 8 | 10,
  rounding: TaxRoundingMode = 'floor',
): number {
  assertYen(exclusiveYen, '税抜金額');
  const raw = exclusiveYen * (1 + ratePercent / 100);
  switch (rounding) {
    case 'floor':
      return Math.floor(raw);
    case 'round':
      return Math.round(raw);
    case 'ceil':
      return Math.ceil(raw);
  }
}
