import { createElement as h, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ledgerTx } from '../helpers/ledger';
import type { RecordEdit } from '../../app/(app)/record-sheet';

const state = vi.hoisted(() => ({
  edit: null as RecordEdit | null,
  refresh: vi.fn(),
  save: vi.fn(),
  restored: vi.fn(),
  undo: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('@/components/ui/bottom-sheet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/bottom-sheet')>()),
  BottomSheet: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/lib/undo', () => ({ pushUndo: (...args: unknown[]) => state.undo(...args) }));
vi.mock('../../app/(app)/record-sheet', () => ({
  RecordSheet: ({ edit }: { edit: RecordEdit }) => {
    state.edit = edit;
    return h('div');
  },
}));
vi.mock('../../app/(app)/transactions/actions', () => ({
  editTransactionAction: (...args: unknown[]) => state.save(...args),
  restoreRowFieldsAction: (...args: unknown[]) => state.restored(...args),
}));
vi.mock('../../app/(app)/transactions/direct-record-actions', () => ({
  loadDirectRecordDetailsAction: vi.fn(),
}));
vi.mock('../../app/(app)/transactions/receipt-items-panel', () => ({
  ReceiptItemsPanel: () => null,
}));

const { DirectRecordEditor } = await import('../../app/(app)/transactions/direct-record-editor');

beforeEach(() => {
  vi.clearAllMocks();
  state.edit = null;
  state.save.mockResolvedValue({ error: null, previous: [{ id: 't' }] });
});

describe('ホーム・予定のその場編集', () => {
  it('保存した日付・金額を共通Actionへ渡し、元画面を更新してUndoを残す', async () => {
    const onSaved = vi.fn();
    renderToString(
      h(DirectRecordEditor, {
        transaction: ledgerTx({ id: 't', kind: 'special' }),
        initialOpen: true,
        onSaved,
        children: '予定',
      }),
    );
    state.edit!.onSave(
      {
        kind: 'expense',
        amountYen: 2500,
        genreId: 'food',
        date: '2026-11-02',
        name: '買い物',
        memo: '予定を変更',
      },
      '食料品',
    );
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(state.save).toHaveBeenCalledWith('t', {
      genreId: 'food',
      amountYen: -2500,
      occurredOn: '2026-11-02',
      description: '買い物',
      memo: '予定を変更',
    });
    expect(state.refresh).toHaveBeenCalledOnce();
    expect(state.undo).toHaveBeenCalledOnce();
  });

  it('確認待ちは同じ分類のままでも保存でき、返金への変更は符号と種類を保つ', async () => {
    renderToString(
      h(DirectRecordEditor, {
        transaction: ledgerTx({ id: 't' }),
        initialOpen: true,
        confirmReview: true,
        children: '確認する',
      }),
    );
    expect(state.edit!.saveUnchanged).toBe(true);
    expect(state.edit!.saveLabel).toBe('確認して保存');
    state.edit!.onSave({ ...state.edit!.initial, kind: 'refund', amountYen: 1000 }, null);
    await vi.waitFor(() => expect(state.save).toHaveBeenCalledOnce());
    expect(state.save.mock.calls[0]![1]).toMatchObject({ amountYen: 1000, kind: 'refund' });
  });
});
