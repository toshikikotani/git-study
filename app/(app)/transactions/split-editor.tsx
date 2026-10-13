'use client';

import { useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { SwipeableRow } from '@/components/ui/swipeable-row';
import { formatYen } from '@/domain/money';
import { receiptItemsStatus } from '@/domain/receipt-items';
import { GenreBadge } from '@/components/ui/genre-badge';
import { LedgerAmount } from '@/components/ui/money';
import { useGenreOverrides } from '@/components/ui/genre-style-context';
import { genreBarColor } from '@/domain/genre-style';
import { predictGenres, type GenreHistoryEntry } from '@/domain/genre-prediction';
import { MdReceiptLong } from 'react-icons/md';
import { ReceiptImageViewer } from '@/components/receipt/receipt-image-viewer';
import { isRiskyPaymentMethod } from '@/features/classification/rules';
import type { GenreShare } from '@/features/spending/views';
import type { GenreOption } from '@/features/genre/store';
import type { PaymentMethod } from '@/features/import/adapters';
import type { ReceiptItem } from '@/features/receipts/items-store';
import type { TransactionSplit } from '@/features/transactions/splits-store';
import type { StoredTransaction } from '@/features/transactions/store';
import { hapticFor } from '@/lib/haptics';
import { pushUndo } from '@/lib/undo';
import { resizeToJpegBase64 } from '@/features/import/resize-image';
import {
  deleteTransactionAction,
  duplicateTransactionAction,
  recordGenreCorrectionAction,
  replaceReceiptItemsAction,
  replaceSplitsAction,
  restoreDeletedTransactionAction,
  restoreRowFieldsAction,
  updateTransactionAction,
  updateTransactionMemoAction,
} from './actions';
import { ReceiptItemsPanel } from './receipt-items-panel';

const METHOD_LABEL: Partial<Record<PaymentMethod, string>> = {
  revolving: 'リボ払い',
  cashing: 'キャッシング',
  installment: '分割払い',
};

type SplitRowState = { genreId: string; amountYen: string; note: string };

/**
 * 明細1行 + カテゴリの編集(単一カテゴリの変更・複数カテゴリへの分割)。
 */
export type EditableTransaction = Pick<
  StoredTransaction,
  | 'id'
  | 'accountId'
  | 'occurredOn'
  | 'description'
  | 'amountYen'
  | 'paymentMethod'
  | 'genreId'
  | 'genreName'
  | 'memo'
>;

export type RowDisplay = {
  name: string;
  branch: string | null;
  thumbnailUrl: string | null;
  shares: readonly GenreShare[];
  scheduled: boolean;
  special: boolean;
};

export function TransactionRowWithSplit({
  transaction,
  categories,
  initialSplits,
  receiptItems = [],
  expenseSubtype = null,
  display,
  genreHistory = [],
  justSaved = false,
}: {
  transaction: EditableTransaction;
  justSaved?: boolean;
  display?: RowDisplay;
  genreHistory?: readonly GenreHistoryEntry[];
  categories: readonly GenreOption[];
  initialSplits: readonly TransactionSplit[];
  receiptItems?: readonly ReceiptItem[];
  expenseSubtype?: string | null;
}) {
  const overrides = useGenreOverrides();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'simple' | 'split'>(
    initialSplits.length > 0 ? 'split' : 'simple',
  );
  const [categoryFormOpen, setCategoryFormOpen] = useState(false);
  const [genreId, setGenreId] = useState(transaction.genreId ?? '');
  const [splitYenInput, setSplitYenInput] = useState('');
  const [amountAbsYenInput, setAmountAbsYenInput] = useState(
    String(Math.abs(transaction.amountYen)),
  );
  const [occurredOnInput, setOccurredOnInput] = useState(transaction.occurredOn);
  const [nameInput, setNameInput] = useState(display?.name ?? transaction.description);
  const [memo, setMemo] = useState(transaction.memo);
  const [memoFormOpen, setMemoFormOpen] = useState(false);
  const [memoInput, setMemoInput] = useState(transaction.memo ?? '');
  const [memoSaving, setMemoSaving] = useState(false);
  const [memoError, setMemoError] = useState<string | null>(null);
  const [splits, setSplits] = useState<readonly TransactionSplit[]>(initialSplits);
  const [rows, setRows] = useState<SplitRowState[]>(() => initialRows(initialSplits, categories));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<readonly ReceiptItem[]>(receiptItems);
  const itemsStatus = receiptItemsStatus(items, transaction.amountYen);
  const showCategoryForm = categoryFormOpen;
  const [subtype, setSubtype] = useState(expenseSubtype);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [genreSheetOpen, setGenreSheetOpen] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [itemEditRequest] = useState(0);
  const [editSheetOpen, setEditSheetOpen] = useState(false);

  const isIncome = transaction.amountYen > 0;
  const risky = isRiskyPaymentMethod(transaction.paymentMethod);
  const methodLabel = METHOD_LABEL[transaction.paymentMethod];
  const targetAbsYen = Math.abs(transaction.amountYen);
  const sumAbsYen = rows.reduce((acc, r) => acc + (Number(r.amountYen) || 0), 0);
  const canSave =
    rows.length >= 2 && rows.every((r) => Number(r.amountYen) > 0) && sumAbsYen === targetAbsYen;

  function addRow(): void {
    setRows((prev) => [...prev, { genreId: categories[0]?.id ?? '', amountYen: '', note: '' }]);
  }
  function removeRow(index: number): void {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }
  function updateRow(index: number, patch: Partial<SplitRowState>): void {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const amountAbsYen = Math.max(0, Number(amountAbsYenInput) - (Number(splitYenInput) || 0));
  const nameTrimmed = nameInput.trim();
  const simpleEditUnchanged =
    genreId === (transaction.genreId ?? '') &&
    amountAbsYen === targetAbsYen &&
    occurredOnInput === transaction.occurredOn &&
    nameTrimmed === (display?.name ?? transaction.description) &&
    (Number(splitYenInput) || 0) === 0;
  const canSaveSimpleEdit =
    !!genreId &&
    amountAbsYen > 0 &&
    occurredOnInput !== '' &&
    nameTrimmed !== '' &&
    !simpleEditUnchanged;

  async function saveSimpleEdit(): Promise<void> {
    if (!canSaveSimpleEdit) return;
    setSaving(true);
    setError(null);
    const result = await updateTransactionAction(transaction.id, genreId, {
      amountAbsYen,
      occurredOn: occurredOnInput,
      isIncome,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    const prevGenreId = transaction.genreId ?? '';
    const prevAmount = String(targetAbsYen);
    const prevDate = transaction.occurredOn;
    if (result.previous) {
      const previous = result.previous;
      pushUndo('変更しました', async () => {
        const r = await restoreRowFieldsAction(previous);
        if (r.error) return r.error;
        setGenreId(prevGenreId);
        setAmountAbsYenInput(prevAmount);
        setOccurredOnInput(prevDate);
        return null;
      });
    }
    setOpen(false);
    setCategoryFormOpen(false);
    setEditSheetOpen(false);
  }

  // Placeholder return - full component body needed
  return <div>split editor</div>;
}

function initialRows(
  splits: readonly TransactionSplit[],
  categories: readonly GenreOption[],
): SplitRowState[] {
  if (splits.length === 0) {
    const first = categories[0]?.id ?? '';
    const second = categories[1]?.id ?? first;
    return [
      { genreId: first, amountYen: '', note: '' },
      { genreId: second, amountYen: '', note: '' },
    ];
  }
  return splits.map((s) => ({
    genreId: s.genreId ?? '',
    amountYen: String(Math.abs(s.amountYen)),
    note: s.note ?? '',
  }));
}
