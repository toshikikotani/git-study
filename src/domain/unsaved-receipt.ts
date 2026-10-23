/**
 * 保存前のレシート(v5 変更2、ADR-133)の受け渡しの形。
 *
 * 読み取れたレシートは、本人が「保存」を押すまで記録にしない。そのあいだは receipt_captures に
 * status = 'ready' で置き、アプリを閉じても続きから確かめられるようにする。1枚の写真に2件以上
 * 写っていたら、1件ずつ別の行にする(1件ずつ保存・破棄できるように)。
 *
 * ここは形の変換だけ(DB にも画面にも触れない)。
 */

import type { ParsedReceiptTransaction } from '@/features/import/receipt-ai';
import type { AccountGuess } from './receipt-account';

/** 品目(または明細)ごとのカテゴリの予測。key は「明細の番号」か「明細の番号:品目の番号」。 */
export type ReceiptGenreGuess = {
  key: string;
  genreId: string;
  confidence: number;
  source?: string;
};

export type ReadyPayload = {
  parsed: ParsedReceiptTransaction;
  warnings: string[];
  /** この明細の分だけ(key は 0 始まりに付け直してある:「0」「0:品目の番号」)。 */
  classifications: ReceiptGenreGuess[];
  /** お店の種類から決めた明細のカテゴリ。 */
  parentGenreId: string | null;
  /** 支払い(口座)の当て。読み取りのときに当てられなかったら null。 */
  accountGuess: AccountGuess | null;
};

/** 1枚の写真の読み取り結果を、明細1件ずつに分ける。 */
export function splitReadResult(input: {
  transactions: readonly ParsedReceiptTransaction[];
  warnings: readonly string[];
  classifications: readonly ReceiptGenreGuess[];
  parentGenreIds: Readonly<Record<number, string>>;
  accountGuesses?: Readonly<Record<number, AccountGuess>>;
}): ReadyPayload[] {
  return input.transactions.map((parsed, i) => ({
    parsed,
    // 写真全体の注意(読めなかった行など)は、1件めにだけ付ける(同じ注意を何度も出さない)。
    warnings: i === 0 ? [...input.warnings] : [],
    classifications: input.classifications.flatMap((c) => {
      const [head, ...rest] = c.key.split(':');
      if (head !== String(i)) return [];
      return [{ ...c, key: ['0', ...rest].join(':') }];
    }),
    parentGenreId: input.parentGenreIds[i] ?? null,
    accountGuess: input.accountGuesses?.[i] ?? null,
  }));
}

/** receipt_captures.ocr_raw に置く形(入力待ちと同じく transactions に読み取り結果を持つ)。 */
export function readyPayloadToRaw(payload: ReadyPayload): Record<string, unknown> {
  return {
    kind: 'ready',
    warnings: payload.warnings,
    transactions: [payload.parsed],
    classifications: payload.classifications,
    parentGenreIds: payload.parentGenreId === null ? {} : { 0: payload.parentGenreId },
    accountGuess: payload.accountGuess,
  };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function isParsed(v: unknown): v is ParsedReceiptTransaction {
  return (
    isObject(v) &&
    typeof v.occurredOn === 'string' &&
    typeof v.description === 'string' &&
    typeof v.amountYen === 'number' &&
    Array.isArray(v.items)
  );
}

function toGuess(v: unknown): AccountGuess | null {
  if (!isObject(v) || typeof v.confidence !== 'number') return null;
  const reason = v.reason === 'card' || v.reason === 'history' ? v.reason : 'default';
  return {
    accountId: typeof v.accountId === 'string' ? v.accountId : null,
    confidence: v.confidence,
    reason,
  };
}

/** ocr_raw を読み戻す。形が違えば null(その行は保存前として出さない)。 */
export function parseReadyPayload(raw: unknown): ReadyPayload | null {
  if (!isObject(raw) || !Array.isArray(raw.transactions)) return null;
  const parsed = raw.transactions[0];
  if (!isParsed(parsed)) return null;
  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.filter((w): w is string => typeof w === 'string')
    : [];
  const classifications = Array.isArray(raw.classifications)
    ? raw.classifications.filter(
        (c): c is ReceiptGenreGuess =>
          isObject(c) &&
          typeof c.key === 'string' &&
          typeof c.genreId === 'string' &&
          typeof c.confidence === 'number',
      )
    : [];
  const parent = isObject(raw.parentGenreIds) ? raw.parentGenreIds['0'] : undefined;
  return {
    parsed,
    warnings,
    classifications,
    parentGenreId: typeof parent === 'string' ? parent : null,
    accountGuess: toGuess(raw.accountGuess),
  };
}
