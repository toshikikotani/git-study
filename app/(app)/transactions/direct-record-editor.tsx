'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import type { LedgerTransaction } from '@/features/spending/ledger-types';
import { pushUndo } from '@/lib/undo';
import { RecordSheet, type RecordEditValues } from '../record-sheet';
import { editTransactionAction, restoreRowFieldsAction } from './actions';
import { loadDirectRecordDetailsAction } from './direct-record-actions';
import { ReceiptItemsPanel } from './receipt-items-panel';

/** 画面を移らず共通の記録シートを開き、保存後も一覧の位置を保つ。 */
export function DirectRecordEditor({
  transaction,
  children,
  className,
  initialOpen = false,
  onSaved,
  confirmReview = false,
  onRestored,
}: {
  transaction: LedgerTransaction;
  children: ReactNode;
  className?: string;
  initialOpen?: boolean;
  onSaved?: () => void;
  confirmReview?: boolean;
  onRestored?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [revision, setRevision] = useState(0);
  const [retry, setRetry] = useState<{ values: RecordEditValues; error: string } | null>(null);
  const [details, setDetails] = useState<Awaited<
    ReturnType<typeof loadDirectRecordDetailsAction>
  > | null>(null);
  const [reload, setReload] = useState(0);
  const initial: RecordEditValues = {
    kind:
      transaction.kind === 'refund' ? 'refund' : transaction.amountYen > 0 ? 'income' : 'expense',
    amountYen: Math.abs(transaction.amountYen),
    genreId: transaction.genreId,
    date: transaction.occurredOn,
    name: transaction.label,
    memo: transaction.memo ?? '',
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    void loadDirectRecordDetailsAction(transaction.id)
      .then((value) => {
        if (active) setDetails(value);
      })
      .catch(() => {
        if (active)
          setDetails({
            genres: [],
            items: [],
            subtype: null,
            error: '品目を読み込めませんでした。もう一度お試しください。',
          });
      });
    return () => {
      active = false;
    };
  }, [open, transaction.id, reload]);

  const save = (values: RecordEditValues) => {
    void (async () => {
      try {
        const refundChanged = (values.kind === 'refund') !== (initial.kind === 'refund');
        const result = await editTransactionAction(transaction.id, {
          genreId: values.genreId,
          amountYen: values.kind === 'expense' ? -values.amountYen : values.amountYen,
          occurredOn: values.date,
          description: values.name,
          memo: values.memo,
          ...(refundChanged
            ? { kind: values.kind === 'refund' ? ('refund' as const) : ('normal' as const) }
            : {}),
        });
        if (result.error) throw new Error(result.error);
        if (result.previous) {
          const previous = result.previous;
          pushUndo(`${values.name} を直しました`, async () => {
            const restored = await restoreRowFieldsAction(previous);
            if (!restored.error) onRestored?.();
            return restored.error;
          });
        }
        onSaved?.();
      } catch (error) {
        setRetry({
          values,
          error:
            error instanceof Error
              ? error.message
              : '直せませんでした。もう一度「保存」を押してください。',
        });
        setRevision((value) => value + 1);
        setOpen(true);
      }
    })();
  };

  return (
    <>
      <button
        type="button"
        className={className ?? 'flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left'}
        aria-label={`${transaction.label}、${Math.abs(transaction.amountYen).toLocaleString('ja-JP')}円の記録を直す`}
        onClick={() => {
          setRetry(null);
          setRevision((value) => value + 1);
          setOpen(true);
        }}
      >
        {children}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} role="dialog" label="記録を直す" tall>
        {open ? (
          <RecordSheet
            key={revision}
            onClose={() => setOpen(false)}
            initialError={retry?.error}
            edit={{
              initial: retry?.values ?? initial,
              onSave: save,
              saveUnchanged: confirmReview,
              saveLabel: confirmReview ? '確認して保存' : '保存',
              footer:
                details === null ? (
                  <p
                    role="status"
                    className="px-4 py-3 text-sm"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    品目を読み込み中…
                  </p>
                ) : details.error ? (
                  <div className="px-4 py-3 text-sm" style={{ color: 'var(--ink-muted)' }}>
                    <p role="status">{details.error}</p>
                    <button
                      type="button"
                      className="min-h-11 font-semibold"
                      onClick={() => setReload((value) => value + 1)}
                    >
                      もう一度読み込む
                    </button>
                  </div>
                ) : (
                  <ReceiptItemsPanel
                    transaction={transaction}
                    categories={details.genres}
                    items={details.items}
                    onItemsReplaced={(items) => {
                      setDetails({ ...details, items });
                      router.refresh();
                    }}
                    subtype={details.subtype}
                    onSubtypeReplaced={(subtype) => {
                      setDetails({ ...details, subtype });
                      router.refresh();
                    }}
                  />
                ),
            }}
          />
        ) : null}
      </BottomSheet>
    </>
  );
}
