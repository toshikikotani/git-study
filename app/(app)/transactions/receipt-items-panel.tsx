'use client';

import { pushUndo } from '@/lib/undo';
import { useEffect, useRef, useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { formatYen } from '@/domain/money';
import { receiptItemsStatus } from '@/domain/receipt-items';
import type { GenreOption } from '@/features/genre/store';
import type { PaymentMethod } from '@/features/import/adapters';
import type { ReceiptParseResult } from '@/features/import/receipt-ai';
import { resizeToJpegBase64 } from '@/features/import/resize-image';
import type { ReceiptItem } from '@/features/receipts/items-store';
import { buildPreview } from '@/features/transactions/import-pipeline';
import { replaceReceiptItemsAction, setExpenseSubtypeAction } from './actions';

type EditRowState = {
  name: string;
  amountYen: string;
  genreId: string;
  productType: string | null;
};

function toEditRows(items: readonly ReceiptItem[]): EditRowState[] {
  return items.map((it) => ({
    name: it.name,
    amountYen: String(Math.abs(it.amountYen)),
    genreId: it.genreId ?? '',
    productType: it.productType,
  }));
}

export function ReceiptItemsPanel({
  transaction,
  categories,
  items,
  onItemsReplaced,
  subtype,
  onSubtypeReplaced,
  openRequest = 0,
  summary = true,
}: {
  transaction: {
    id: string;
    occurredOn: string;
    accountId: string;
    paymentMethod: PaymentMethod;
    amountYen: number;
  };
  categories: readonly GenreOption[];
  items: readonly ReceiptItem[];
  onItemsReplaced: (items: ReceiptItem[]) => void;
  subtype: string | null;
  onSubtypeReplaced: (subtype: string) => void;
  openRequest?: number;
  summary?: boolean;
}) {
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRows, setEditRows] = useState<EditRowState[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const targetAbsYen = Math.abs(transaction.amountYen);
  const itemsStatus = receiptItemsStatus(items, transaction.amountYen);

  function openDialog(): void {
    setEditRows(toEditRows(items));
    setEditError(null);
    setRescanError(null);
    setDialogOpen(true);
  }
  function closeDialog(): void {
    setDialogOpen(false);
  }

  const [seenRequest, setSeenRequest] = useState(openRequest);
  if (openRequest !== seenRequest) {
    setSeenRequest(openRequest);
    if (openRequest > 0) {
      setEditRows(toEditRows(items));
      setEditError(null);
      setRescanError(null);
      setDialogOpen(true);
    }
  }

  useEffect(() => {
    if (!dialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDialogOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen]);

  async function rescanReceipt(file: File): Promise<void> {
    setRescanning(true);
    setRescanError(null);
    try {
      const imageBase64 = await resizeToJpegBase64(file);
      const response = await fetch('/api/import/receipt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: imageBase64, mediaType: 'image/jpeg' }),
      });
      const parsed = (await response.json()) as ReceiptParseResult;
      const receipt = parsed.transactions[0];
      if (!receipt) {
        setRescanError(parsed.warnings[0] ?? 'レシートとして読み取れませんでした。');
        return;
      }
      if (receipt.items.length === 0 && receipt.expenseSubtype === null) {
        setRescanError('品目を読み取れませんでした。');
        return;
      }
      if (receipt.items.length > 0) {
        const built = buildPreview(
          receipt.items.map((item) => ({
            occurredOn: transaction.occurredOn,
            description: item.description,
            amountYen: item.amountYen,
            paymentMethod: transaction.paymentMethod,
          })),
          transaction.accountId,
          (i) => `attach-${transaction.id}-${i}`,
          'manual',
        );
        setEditRows(
          built.map((row, i) => ({
            name: row.description,
            amountYen: String(row.amountYen),
            genreId: '',
            productType: receipt.items[i]?.productType ?? null,
          })),
        );
      }
      if (receipt.expenseSubtype !== null) {
        const subtypeResult = await setExpenseSubtypeAction(transaction.id, receipt.expenseSubtype);
        if (!subtypeResult.error) onSubtypeReplaced(receipt.expenseSubtype);
      }
    } catch {
      setRescanError('レシートを読み取れませんでした。');
    } finally {
      setRescanning(false);
    }
  }

  function updateEditRow(index: number, patch: Partial<EditRowState>): void {
    setEditRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const editSign = transaction.amountYen < 0 ? -1 : 1;
  const editSumAbsYen = editRows.reduce((acc, r) => acc + Math.abs(Number(r.amountYen) || 0), 0);
  const canSaveEdit =
    editRows.length > 0 && editRows.every((r) => r.name.trim() !== '' && Number(r.amountYen) > 0);

  async function saveEdit(): Promise<void> {
    setEditSaving(true);
    setEditError(null);
    const payload = editRows.map((r) => ({
      name: r.name.trim(),
      amountYen: editSign * Number(r.amountYen),
      genreId: r.genreId || null,
      productType: r.productType,
    }));
    const result = await replaceReceiptItemsAction(transaction.id, payload);
    if (result.error) {
      setEditError(result.error);
      setEditSaving(false);
      return;
    }
    onItemsReplaced(
      payload.map((p, i) => ({
        id: items[i]?.id ?? `pending-${i}`,
        name: p.name,
        amountYen: p.amountYen,
        genreId: p.genreId,
        genreName: categories.find((c) => c.id === p.genreId)?.name ?? null,
        productType: p.productType,
      })),
    );
    const prevItems = items;
    pushUndo('品目を変更しました', async () => {
      const r = await replaceReceiptItemsAction(
        transaction.id,
        prevItems.map((p) => ({
          name: p.name,
          amountYen: p.amountYen,
          genreId: p.genreId,
          productType: p.productType,
        })),
      );
      if (r.error) return r.error;
      onItemsReplaced([...prevItems]);
      return null;
    });
    setEditSaving(false);
    setDialogOpen(false);
  }

  return (
    <div className={summary ? 'rounded-2xl border p-3' : undefined} style={summary ? { borderColor: 'var(--hairline)' } : undefined}>
      {summary ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>レシートの品目</p>
            <button type="button" onClick={openDialog} className="min-h-11 text-xs font-semibold" style={{ color: 'var(--accent)' }}>
              {items.length > 0 ? '編集する' : 'レシートを登録する'}
            </button>
          </div>
          {items.length > 0 ? (
            <>
              <ul className="mt-2 space-y-1">
                {items.map((item) => (
                  <li key={item.id} className="flex items-baseline justify-between gap-3 text-xs" style={{ color: 'var(--ink-secondary)' }}>
                    <span className="min-w-0 truncate">
                      {item.name}
                      {item.productType ? <span className="ml-1" style={{ color: 'var(--ink-muted)' }}>({item.productType})</span> : null}
                    </span>
                    <span className="tabular shrink-0">{formatYen(item.amountYen, { sign: 'never' })}</span>
                  </li>
                ))}
              </ul>
              {itemsStatus === 'mismatched' ? (
                <p className="mt-1 text-xs" style={{ color: 'var(--over)' }}>品目の合計が金額と一致しません</p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>品目の記録はありません</p>
          )}
          {subtype ? (
            <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>生活費の内訳:{subtype}</p>
          ) : null}
        </>
      ) : null}
      <BottomSheet open={dialogOpen} onClose={closeDialog} role="dialog">
        <div className="flex items-center justify-between px-3 pt-1 pb-2">
          <h2 className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>品目を編集</h2>
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>外側をタップで閉じる</span>
        </div>
        <div className="space-y-2 px-3 pb-3">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            品目ごとに品名・金額・カテゴリを直せます。合計を一致させる必要はありません。
          </p>
          <input ref={receiptInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void rescanReceipt(file); }} />
          <button type="button" onClick={() => receiptInputRef.current?.click()} disabled={rescanning} className="min-h-11 w-full rounded-xl py-2 text-sm font-semibold disabled:opacity-40" style={{ background: 'var(--plane)', color: 'var(--accent)', border: '1px solid var(--hairline)' }}>
            {rescanning ? '読み取っています…' : editRows.length > 0 ? 'レシートを読み込み直す' : 'レシートを読み込む'}
          </button>
          {rescanError ? <p className="text-xs" style={{ color: 'var(--over)' }}>{rescanError}</p> : null}
          {editRows.map((row, index) => (
            <div key={index} className="flex gap-2">
              <input type="text" value={row.name} onChange={(e) => updateEditRow(index, { name: e.target.value })} placeholder="品名" className="flex-1 rounded-xl px-3 py-2 text-sm" style={{ background: 'var(--plane)', color: 'var(--ink)', border: '1px solid var(--hairline)' }} />
              <select value={row.genreId} onChange={(e) => updateEditRow(index, { genreId: e.target.value })} className="rounded-xl px-2 py-2 text-sm" style={{ background: 'var(--plane)', color: 'var(--ink)', border: '1px solid var(--hairline)' }}>
                <option value="">未分類</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input type="text" inputMode="numeric" value={row.amountYen} onChange={(e) => updateEditRow(index, { amountYen: e.target.value.replace(/[^0-9]/g, '') })} placeholder="金額" className="w-20 rounded-xl px-3 py-2 text-sm" style={{ background: 'var(--plane)', color: 'var(--ink)', border: '1px solid var(--hairline)' }} />
            </div>
          ))}
          {editRows.length > 0 ? (
            <div className="flex items-center justify-between">
              <span className="tabular text-xs" style={{ color: editSumAbsYen === targetAbsYen ? 'var(--ink-muted)' : 'var(--over)' }}>
                品目合計 {formatYen(editSumAbsYen, { sign: 'never' })}(明細額 {formatYen(targetAbsYen, { sign: 'never' })})
              </span>
            </div>
          ) : null}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => void saveEdit()} disabled={editSaving || !canSaveEdit} className="min-h-11 flex-1 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40" style={{ background: 'var(--action)', color: 'var(--on-action)' }}>
              {editSaving ? '保存中…' : '保存'}
            </button>
            <button type="button" onClick={closeDialog} disabled={editSaving} className="min-h-11 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40" style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}>
              やめる
            </button>
          </div>
          {editError ? <p className="text-xs" style={{ color: 'var(--over)' }}>{editError}</p> : null}
        </div>
      </BottomSheet>
    </div>
  );
}
