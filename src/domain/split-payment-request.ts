/**
 * 選んだ支出から、相手に送る割り勘の依頼文を作る。
 * 計算には親明細の記録額だけを使い、カテゴリ分割や品目は加算しない。
 * 記録額は既存の割り勘受取分を差し引いた後の場合もあるため、元額は推測しない。
 */

import type { LedgerTransaction } from '@/features/spending/ledger-types';
import { assertDateOnly } from '@/lib/date';
import { assertYen, formatYen, MAX_YEN } from './money';

export type SplitPaymentEntry = Pick<
  LedgerTransaction,
  | 'id'
  | 'occurredOn'
  | 'label'
  | 'branchName'
  | 'amountYen'
  | 'status'
  | 'kind'
  | 'isTransfer'
  | 'reviewStatus'
  | 'needsInput'
>;

export type SplitPaymentRequest = {
  entries: readonly SplitPaymentEntry[];
  totalYen: number;
  participants: number;
  amountPerPersonYen: number;
  requesterShareYen: number;
  remainderYen: number;
  message: string;
};

/** 実績の支出だけを選べる。受取・返金・振替・対象外・入力待ちは含めない。 */
export function isSplitPaymentEligible(entry: SplitPaymentEntry): boolean {
  return (
    entry.status === 'actual' &&
    Number.isSafeInteger(entry.amountYen) &&
    entry.amountYen < 0 &&
    entry.amountYen >= -MAX_YEN &&
    entry.kind !== 'refund' &&
    !entry.isTransfer &&
    entry.reviewStatus !== 'ignored' &&
    !entry.needsInput
  );
}

/** 改行・制御文字を文面の構造として扱わず、店名の中の空白に揃える。 */
function singleLine(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim();
}

/**
 * 自分を含む総人数で割る。相手は全員同額にし、1円未満の端数は自分が負担する。
 * コピー用の計算だけを行い、元の明細・帳簿は書き換えない。
 */
export function buildSplitPaymentRequest(
  entries: readonly SplitPaymentEntry[],
  people: number,
): SplitPaymentRequest {
  if (!Number.isSafeInteger(people) || people < 2) {
    throw new Error('人数は私を含めて2人以上の整数で入力してください。');
  }
  if (entries.length === 0) {
    throw new Error('割り勘にする明細を選んでください。');
  }

  const seen = new Set<string>();
  const selected: SplitPaymentEntry[] = [];
  let totalYen = 0;

  for (const entry of entries) {
    if (!isSplitPaymentEligible(entry)) {
      throw new Error('割り勘にできない明細があります。実績の支出を選び直してください。');
    }
    if (entry.id.trim() === '') {
      throw new Error('明細を確認できません。選び直してください。');
    }
    assertDateOnly(entry.occurredOn);
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    totalYen = assertYen(totalYen - entry.amountYen, '割り勘の合計');

    // 余剰のフィールド(メモ・口座・画像等)をコピー画面へ持ち込まない。
    selected.push({
      id: entry.id,
      occurredOn: entry.occurredOn,
      label: singleLine(entry.label) || '名称なし',
      branchName: entry.branchName === null ? null : singleLine(entry.branchName) || null,
      amountYen: entry.amountYen,
      status: entry.status,
      kind: entry.kind,
      isTransfer: entry.isTransfer,
      reviewStatus: entry.reviewStatus,
      needsInput: entry.needsInput,
    });
  }

  const amountPerPersonYen = Math.floor(totalYen / people);
  if (amountPerPersonYen === 0) {
    throw new Error('1人あたりの請求額が1円以上になる人数で入力してください。');
  }
  const remainderYen = totalYen % people;
  const requesterShareYen = assertYen(amountPerPersonYen + remainderYen, '私の負担額');
  const message = [
    '割り勘のお願い',
    '',
    ...selected.map(
      (entry) =>
        `・${entry.occurredOn.replaceAll('-', '/')} ${[entry.label, entry.branchName].filter(Boolean).join(' ')} ${formatYen(-entry.amountYen)}`,
    ),
    '',
    `合計: ${formatYen(totalYen)}`,
    `人数: ${people.toLocaleString('ja-JP')}人（私を含む）`,
    `1人あたりの請求額: ${formatYen(amountPerPersonYen)}`,
    remainderYen > 0 ? `端数${formatYen(remainderYen)}は私が負担します。` : '端数はありません。',
    '',
    `${formatYen(amountPerPersonYen)}をお願いします。`,
  ].join('\n');

  return {
    entries: selected,
    totalYen,
    participants: people,
    amountPerPersonYen,
    requesterShareYen,
    remainderYen,
    message,
  };
}
