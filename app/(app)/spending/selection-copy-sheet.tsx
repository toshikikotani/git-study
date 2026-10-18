'use client';

import { useRef, useState } from 'react';

import { BottomSheet, BottomSheetHeader } from '@/components/ui/bottom-sheet';
import { buildLedgerSelectionText } from '@/domain/ledger-selection';
import type { SplitPaymentEntry } from '@/domain/split-payment-request';

type Props = {
  transactions: readonly SplitPaymentEntry[];
  onClose: () => void;
};

export function SelectionCopySheet({ open, transactions, onClose }: Props & { open: boolean }) {
  return (
    <BottomSheet open={open} onClose={onClose} label="内容をコピー" tall>
      <SelectionCopyForm transactions={transactions} onClose={onClose} />
    </BottomSheet>
  );
}

export function SelectionCopyForm({ transactions, onClose }: Props) {
  const previewRef = useRef<HTMLTextAreaElement>(null);
  const copyingRef = useRef(false);
  const [copying, setCopying] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<{ key: string; message: string } | null>(null);

  let text: string | null = null;
  let error: string | null = null;
  try {
    text = buildLedgerSelectionText(transactions);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : '明細を確認してください。';
  }
  // 同じ文面でも別の明細へ変わったとき、以前のコピー結果を持ち越さない。
  const selectionKey = JSON.stringify([transactions.map((entry) => entry.id), text]);

  async function copy() {
    if (text === null || copyingRef.current) return;
    const snapshot = text;
    const key = selectionKey;
    copyingRef.current = true;
    setCopying(true);
    setCopiedKey(null);
    setCopyError(null);
    try {
      if (!navigator.clipboard?.writeText) {
        setCopyError({
          key,
          message: 'このブラウザではコピーできません。文面を選択してコピーしてください。',
        });
        return;
      }
      await navigator.clipboard.writeText(snapshot);
      setCopiedKey(key);
    } catch {
      setCopyError({ key, message: 'コピーできませんでした。文面を選択してコピーしてください。' });
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
  }

  return (
    <div className="pb-4" style={{ color: 'var(--ink)' }}>
      <BottomSheetHeader className="mb-5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 justify-self-start px-2 text-sm font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          戻る
        </button>
        <h2 className="text-base font-semibold">内容をコピー</h2>
        <button
          type="button"
          onClick={copy}
          disabled={text === null || copying}
          className="min-h-11 justify-self-end px-2 text-sm font-semibold disabled:opacity-40"
          style={{ color: 'var(--accent)' }}
        >
          {copying ? 'コピー中…' : 'コピー'}
        </button>
      </BottomSheetHeader>

      {error ? (
        <p role="alert" className="text-sm">
          {error}
        </p>
      ) : null}
      {text !== null ? (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
            コピーする内容を確認してください。予定や対象外などの状態も含まれます。
          </p>
          <div>
            <label htmlFor="ledger-selection-message" className="mb-2 block text-sm font-semibold">
              コピーする文面
            </label>
            <textarea
              id="ledger-selection-message"
              ref={previewRef}
              readOnly
              value={text}
              rows={Math.min(16, Math.max(8, text.split('\n').length))}
              className="w-full resize-y rounded-2xl border p-4 text-sm leading-relaxed"
              style={{
                background: 'var(--surface)',
                borderColor: 'var(--hairline)',
                color: 'var(--ink)',
              }}
            />
            <button
              type="button"
              onClick={() => {
                const preview = previewRef.current;
                if (!preview) return;
                preview.focus();
                preview.select();
                preview.setSelectionRange(0, preview.value.length);
              }}
              className="min-h-11 px-2 text-sm font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              文面を選択
            </button>
          </div>
          {copiedKey === selectionKey ? (
            <p role="status" className="text-sm font-semibold">
              コピーしました
            </p>
          ) : null}
          {copyError?.key === selectionKey ? (
            <p role="alert" className="text-sm">
              {copyError.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
