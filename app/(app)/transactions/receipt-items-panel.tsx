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

  const seenRequest = useRef(openRequest);
  useEffect(() => {
    if (openRequest === seenRequest.current) return;
    seenRequest.current = openRequest;
    if (openRequest > 0) {
      setEditRows(toEditRows(items));
      setEditError(null);
      setRescanError(null);
      setDialogOpen(true);
    }
  }, [openRequest, items]);

  useEffect(() => {
    if (!dialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDialog();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen]);

  return null;
}
