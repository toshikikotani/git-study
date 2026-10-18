/** 選択した親明細だけを、確認して共有できる文面にする。帳簿は変更しない。 */
import type { SplitPaymentEntry } from '@/domain/split-payment-request';
import { assertDateOnly } from '@/lib/date';
import { assertYen, formatYen } from './money';

const singleLine = (value: string): string => value.replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim();

/**
 * 状態の異なる明細もコピーできる。合計は出さず、方向と状態を各明細へ残す。
 * 分割子・メモ・口座・画像などは読まず、同じ親IDは最初の1件だけを扱う。
 */
export function buildLedgerSelectionText(entries: readonly SplitPaymentEntry[]): string {
  if (entries.length === 0) throw new Error('コピーする明細を選んでください。');

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.id.trim() === '') throw new Error('明細を確認できません。選び直してください。');
    assertDateOnly(entry.occurredOn);
    assertYen(entry.amountYen, '明細の金額');
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);

    const name = [singleLine(entry.label) || '名称なし', singleLine(entry.branchName ?? '')]
      .filter(Boolean)
      .join(' ');
    const direction =
      entry.amountYen < 0
        ? entry.isTransfer
          ? '出金'
          : '支出'
        : entry.amountYen > 0
          ? '入金'
          : '金額';
    const amount =
      entry.needsInput && entry.amountYen === 0
        ? '金額未確定（記録額 0円）'
        : `${entry.needsInput ? '記録額 ' : ''}${direction} ${formatYen(entry.amountYen, { sign: 'never' })}`;
    const states = [
      entry.status === 'scheduled' ? '予定' : '実績',
      entry.kind === 'refund' ? '返金' : entry.kind === 'special' ? '特別費' : null,
      entry.isTransfer ? '振替' : null,
      entry.reviewStatus === 'ignored' ? '対象外' : null,
      entry.needsInput ? '入力待ち' : null,
      entry.reviewStatus === 'pending' ? '確認待ち' : null,
    ].filter(Boolean);
    lines.push(
      `・${entry.occurredOn.replaceAll('-', '/')} ${name} ${amount}［${states.join('・')}］`,
    );
  }

  return [`選択した明細（${lines.length.toLocaleString('ja-JP')}件）`, '', ...lines].join('\n');
}
