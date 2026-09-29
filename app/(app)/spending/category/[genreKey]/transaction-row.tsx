'use client';

import { LedgerAmount } from '@/components/ui/money';
import { MdReceiptLong } from 'react-icons/md';
import type { CategoryLine } from '@/features/category/model';

/** 品目のプレビュー(先頭3件 + ほか○点)。 */
export function itemsPreview(line: CategoryLine): string {
  const names = line.tx.items.map((i) => i.name);
  if (names.length === 0) return '';
  return names.slice(0, 3).join('、') + (names.length > 3 ? ` ほか${names.length - 3}点` : '');
}

/**
 * カテゴリ詳細の取引の行。店名(切れないように折り返す)、支店名と品目のプレビュー、
 * 分割したレシートは「レシート全体 ○円のうち」、返品・返金は緑の「+」。
 * 家計簿の明細の行と同じ見た目の部品(LedgerAmount・区切り線)を使う。
 */
export function CategoryTransactionRow({
  line,
  onOpen,
  selected = false,
  selectMode = false,
  rowRef,
}: {
  line: CategoryLine;
  onOpen: (line: CategoryLine) => void;
  selected?: boolean;
  selectMode?: boolean;
  rowRef?: (el: HTMLDivElement | null) => void;
}) {
  const subtitle = [line.branchName, itemsPreview(line)].filter((x) => x && x !== '').join(' ・ ');
  const spoken = `${line.label}、${line.refund ? '返品・返金' : '支出'}${Math.abs(line.amountYen).toLocaleString('ja-JP')}円${line.receiptTotalYen !== null ? `、レシート全体${line.receiptTotalYen.toLocaleString('ja-JP')}円のうち` : ''}${line.status === 'scheduled' ? '、予定' : ''}`;
  return (
    <div
      ref={rowRef}
      data-row-id={line.txId}
      style={line.status === 'scheduled' ? { opacity: 0.85 } : undefined}
    >
      <button
        type="button"
        onClick={() => onOpen(line)}
        aria-label={spoken}
        aria-pressed={selectMode ? selected : undefined}
        className="min-h-14 flex w-full items-center gap-3 px-4 py-3 text-left"
        style={selected ? { background: 'var(--accent-track)' } : undefined}
      >
        {selectMode ? (
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs"
            style={{
              borderColor: 'var(--ink-muted)',
              background: selected ? 'var(--accent)' : 'transparent',
              color: 'var(--on-accent)',
            }}
          >
            {selected ? '✓' : ''}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug break-words" style={{ color: 'var(--ink)' }}>
            {line.label}
            {line.status === 'scheduled' ? (
              <span
                className="ml-2 rounded-full px-2 py-1 align-middle text-xs font-semibold"
                style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
              >
                予定
              </span>
            ) : null}
            {line.refund ? (
              <span
                className="ml-2 rounded-full px-2 py-1 align-middle text-xs font-semibold"
                style={{ background: 'var(--income-track)', color: 'var(--income)' }}
              >
                返品・返金
              </span>
            ) : null}
          </p>
          {subtitle !== '' ? (
            <p className="mt-1 truncate text-xs" style={{ color: 'var(--ink-secondary)' }}>
              {subtitle}
            </p>
          ) : null}
          {line.receiptTotalYen !== null ? (
            <p className="tabular mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
              レシート全体 {line.receiptTotalYen.toLocaleString('ja-JP')}円のうち
            </p>
          ) : null}
        </div>
        {line.tx.thumbnailUrl ? (
          <MdReceiptLong aria-hidden size={18} style={{ color: 'var(--ink-muted)' }} />
        ) : null}
        <LedgerAmount amountYen={line.amountYen} className="shrink-0 text-sm font-semibold" />
      </button>
    </div>
  );
}
