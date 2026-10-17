import { createElement as h, isValidElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHookState } from '../helpers/hook-state';
import type {
  ReceiptConfirm,
  ReceiptConfirmSave,
} from '../../app/(app)/transactions/receipt/receipt-confirm';
import { newJob } from '@/features/import/receipt-queue';
import { ledgerTx } from '../helpers/ledger';

const state = vi.hoisted(() => ({
  host: null as ReturnType<typeof createHookState> | null,
  cards: [] as Parameters<typeof ReceiptConfirm>[0][],
  jobs: [] as ReturnType<typeof newJob>[],
  save: vi.fn(),
  remove: vi.fn(),
  goal: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useState']>) =>
    state.host!.hooks.useState(...args),
  useRef: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useRef']>) =>
    state.host!.hooks.useRef(...args),
  useEffect: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useEffect']>) =>
    state.host!.hooks.useEffect(...args),
  useMemo: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useMemo']>) =>
    state.host!.hooks.useMemo(...args),
  useCallback: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useCallback']>) =>
    state.host!.hooks.useCallback(...args),
}));
vi.mock('../../app/(app)/transactions/receipt/receipt-confirm', () => ({
  ReceiptConfirm: (props: Parameters<typeof ReceiptConfirm>[0]) => {
    state.cards.push(props);
    return null;
  },
}));
vi.mock('@/features/import/receipt-queue', async (original) => ({
  ...(await original<typeof import('@/features/import/receipt-queue')>()),
  useReceiptJobs: () => state.jobs,
  removeReceiptJob: (...args: unknown[]) => state.remove(...args),
}));
vi.mock('../../app/(app)/transactions/input-account', () => ({
  InputAccountSelector: () => null,
  useInputAccount: () => ({ selectedAccount: { id: 'cash' } }),
}));
vi.mock('@/features/transactions/genres-client', () => ({ fetchGenreOptions: async () => [] }));
vi.mock('../../app/(app)/plan/actions', () => ({
  loadGoalSnapshotAction: () => state.goal(),
}));
vi.mock('../../app/(app)/transactions/actions', () => ({
  saveImportBatchAction: (...args: unknown[]) => state.save(...args),
  recordGenreCorrectionAction: async () => undefined,
  undoReceiptSaveAction: async () => ({ error: null }),
}));
vi.mock('@/lib/just-saved', () => ({ markJustSaved: vi.fn() }));

import ReceiptPage from '../../app/(app)/transactions/receipt/page';

const input: ReceiptConfirmSave = {
  plan: {
    transaction: {
      ...ledgerTx({ id: 'receipt' }),
      merchantName: 'お店',
      classifiedBy: 'manual',
      confidence: null,
      source: 'manual',
      fingerprint: 'fp',
      batchId: null,
      sourceRef: 'ref',
    },
    items: [],
    splits: null,
    expenseSubtype: null,
  },
  corrections: [],
  storeName: 'お店',
  imageBase64: null,
  goalMessage: null,
};
const ok = { error: null, imported: 1, insertedIds: ['saved'] };
function render() {
  state.host!.begin();
  state.cards = [];
  const html = renderToString(h(ReceiptPage));
  state.host!.flush();
  return html;
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  render();
}

beforeEach(() => {
  state.host = createHookState();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  state.jobs = [
    { ...newJob('job', 'blob:receipt', 0), status: 'ready', parsed: [{} as never, {} as never] },
  ];
  state.save.mockResolvedValue(ok);
  state.goal.mockResolvedValue({ snapshot: null, today: '2026-10-17' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('レシートの並行保存と通信失敗', () => {
  it('目標の取得エラーを目標なしと扱わず、再確認の成功後にだけ保存の準備が整う', async () => {
    state.goal.mockResolvedValueOnce({
      snapshot: null,
      today: '2026-10-17',
      error: '目標を確認できませんでした。',
    });
    render();
    await settle();
    const html = render();
    expect(html).toContain('目標を確認できませんでした');
    expect(state.cards.every((card) => card.autoSaveReady === false)).toBe(true);
    state.host!.begin();
    const pending: ReactNode[] = [ReceiptPage()];
    let retry: (() => void) | undefined;
    while (pending.length > 0) {
      const node = pending.pop();
      if (Array.isArray(node)) {
        pending.push(...node);
        continue;
      }
      if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) continue;
      if (node.type === 'button' && node.props.children === '目標への影響を再確認する')
        retry = node.props.onClick;
      pending.push(node.props.children);
    }
    expect(retry).toBeDefined();
    retry!();
    await settle();
    expect(state.goal).toHaveBeenCalledTimes(2);
    expect(state.cards.every((card) => card.autoSaveReady === true)).toBe(true);
  });

  it('同じレシートを連打しても一度だけ保存し、別のレシートは並行して保存できる', async () => {
    let finish!: (value: typeof ok) => void;
    state.save.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render();
    await settle();
    const [first, second] = state.cards;
    first!.onSave(input);
    first!.onSave(input);
    second!.onSave(input);
    render();
    expect(state.save).toHaveBeenCalledTimes(2);
    expect(state.cards.map((card) => card.saving)).toEqual([true, true]);
    finish(ok);
    await settle();
    expect(state.cards.every((card) => card.savedLabel !== null && !card.saving)).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(state.remove).toHaveBeenCalledExactlyOnceWith('job');
  });

  it.each(['network', 'server'])(
    '保存失敗(%s)でも結果を残し、手動で再試行できる',
    async (failure) => {
      if (failure === 'network') state.save.mockRejectedValueOnce(new Error('offline'));
      else state.save.mockResolvedValueOnce({ ...ok, error: '権限を確認してください' });
      render();
      await settle();
      state.cards[0]!.onSave(input);
      await settle();
      const html = render();
      expect(html).toContain(
        failure === 'network' ? '読み取り結果は残っています' : '権限を確認してください',
      );
      expect(state.cards[0]!.saving).toBe(false);
      expect(state.cards[0]!.savedLabel).toBeNull();
      expect(state.remove).not.toHaveBeenCalled();
      state.cards[0]!.onSave(input);
      await settle();
      expect(state.save).toHaveBeenCalledTimes(2);
      expect(state.cards[0]!.savedLabel).not.toBeNull();
    },
  );
});
