import { createElement as h, isValidElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHookState } from '../helpers/hook-state';
import { buildFromAiRows, type ExtractionRow } from '@/features/import/receipt-ai';
import type { ReadyReceiptView } from '@/features/receipt-captures/types';

/**
 * 保存前のレシート(v5 変更2、ADR-133):読み取りが完璧でも、本人が「保存」を押すまで明細に入らない。
 */
const s = vi.hoisted(() => ({
  host: null as ReturnType<typeof createHookState> | null,
  save: vi.fn(),
  resolve: vi.fn(),
  duplicates: vi.fn(),
  hidden: new Set<string>(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (...a: Parameters<ReturnType<typeof createHookState>['hooks']['useState']>) =>
    s.host!.hooks.useState(...a),
  useEffect: (...a: Parameters<ReturnType<typeof createHookState>['hooks']['useEffect']>) =>
    s.host!.hooks.useEffect(...a),
  useMemo: (...a: Parameters<ReturnType<typeof createHookState>['hooks']['useMemo']>) =>
    s.host!.hooks.useMemo(...a),
  useCallback: (...a: Parameters<ReturnType<typeof createHookState>['hooks']['useCallback']>) =>
    s.host!.hooks.useCallback(...a),
  useRef: (...a: Parameters<ReturnType<typeof createHookState>['hooks']['useRef']>) =>
    s.host!.hooks.useRef(...a),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    h('a', { href }, children),
}));
vi.mock('@/components/ui/bottom-sheet', () => ({ BottomSheet: () => null }));
vi.mock('../../app/(app)/transactions/receipt/receipt-check', () => ({
  ReceiptCheck: () => null,
  InlineToast: () => null,
}));
vi.mock('../../app/(app)/genre-picker-sheet', () => ({
  useGenreChoices: () => ({
    genres: [
      { id: 'food', name: '食料品' },
      { id: 'goods', name: '日用品' },
    ],
    recentIds: [],
  }),
}));
vi.mock('../../app/(app)/transactions/input-account', () => ({
  useInputAccount: () => ({
    accounts: [{ id: 'cash', name: '現金' }],
    accountId: 'cash',
    error: null,
    retry: () => {},
  }),
}));
vi.mock('../../app/(app)/plan/actions', () => ({
  loadGoalSnapshotAction: async () => ({ error: null, snapshot: null, today: '2026-10-23' }),
}));
vi.mock('../../app/(app)/transactions/actions', () => ({
  checkReceiptDuplicatesAction: (...a: unknown[]) => s.duplicates(...a),
  saveImportBatchAction: (...a: unknown[]) => s.save(...a),
  mergeReceiptIntoPaymentAction: vi.fn(),
  recordGenreCorrectionAction: vi.fn(async () => ({ error: null })),
  undoReceiptSaveAction: vi.fn(async () => ({ error: null })),
}));
vi.mock('../../app/(app)/transactions/receipt/capture-actions', () => ({
  discardCaptureAction: vi.fn(async () => ({ error: null })),
  readyImagePathAction: vi.fn(async () => 'u/r.jpg'),
  resolveReadyCaptureAction: (...a: unknown[]) => s.resolve(...a),
  restoreCaptureAction: vi.fn(async () => ({ error: null })),
}));
vi.mock('@/features/import/receipt-queue', () => ({
  useReceiptJobs: () => [],
  useHiddenReceiptKeys: () => s.hidden,
  hideUnsavedReceipt: (key: string) => s.hidden.add(key),
  unhideUnsavedReceipt: (key: string) => s.hidden.delete(key),
  removeReceiptJob: vi.fn(),
  retryWaitingJobs: vi.fn(),
}));
vi.mock('@/lib/just-saved', () => ({ markJustSaved: vi.fn() }));

const { ReceiptResults } = await import('../../app/(app)/transactions/receipt/receipt-results');

const row = (store: string, yen: number): ExtractionRow => ({
  occurred_on: '2026-10-22',
  amount_yen: yen,
  store_name: store,
  payment_method_text: '',
  items: [],
  expense_subtype: '',
  price_basis: 'tax_included',
  tax_8_yen: 0,
  tax_10_yen: 0,
  points_used_yen: 0,
  coupon_yen: 0,
  store_confidence: 1,
  date_confidence: 1,
  total_confidence: 1,
});
const ready = (id: string, store: string, yen: number): ReadyReceiptView => ({
  id,
  imageUrl: null,
  imagePath: 'u/r.jpg',
  capturedOn: '2026-10-22',
  createdAt: '2026-10-22T01:00:00Z',
  parsed: buildFromAiRows([row(store, yen)]).transactions[0]!,
  warnings: [],
  classifications: [{ key: '0', genreId: 'food', confidence: 1, source: 'rule' }],
  parentGenreId: 'food',
  accountGuess: { accountId: 'cash', confidence: 1, reason: 'card' },
});

function run(props: Parameters<typeof ReceiptResults>[0]) {
  s.host!.begin();
  const tree = ReceiptResults(props);
  s.host!.flush();
  return tree;
}
function find(node: ReactNode, label: string): (() => void) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, label);
      if (hit) return hit;
    }
    return;
  }
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return;
  if (node.type === 'button' && node.props.children === label) return node.props.onClick;
  return find(node.props.children, label);
}
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  s.host = createHookState();
  s.hidden.clear();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  s.duplicates.mockResolvedValue({ duplicates: {}, error: null });
  s.save.mockResolvedValue({
    imported: 1,
    duplicates: 0,
    error: null,
    splitWarnings: [],
    insertedIds: ['tx-1'],
  });
  s.resolve.mockResolvedValue({ error: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('保存前のレシート', () => {
  it('読み取りが完璧でも、待っていても保存しない(自動保存をやめた)', async () => {
    run({ ready: [ready('cap-1', 'スギ薬局', 700)] });
    await vi.advanceTimersByTimeAsync(5000);
    run({ ready: [ready('cap-1', 'スギ薬局', 700)] });
    await vi.advanceTimersByTimeAsync(5000);
    await settle();
    expect(s.save).not.toHaveBeenCalled();
  });

  it('「保存」を押したときだけ、残しておいた画像を付けて保存し、保存前の印を外す', async () => {
    const tree = run({ ready: [ready('cap-1', 'スギ薬局', 700)] });
    const save = find(tree, '保存');
    expect(save).toBeDefined();
    save!();
    await settle();
    expect(s.save).toHaveBeenCalledOnce();
    expect(s.save.mock.calls[0]![1]).toMatchObject({
      receiptImagePath: 'u/r.jpg',
      accountId: 'cash',
      keepSeparate: false,
    });
    expect(s.resolve).toHaveBeenCalledWith('cap-1', 'tx-1');
    expect(s.hidden.has('cap-1')).toBe(true);
  });

  it('そろっているものが2件以上なら「そろっている N件を保存」。押す前に店名と金額を見せる', async () => {
    const tree = run({
      ready: [ready('cap-1', 'スギ薬局', 700), ready('cap-2', 'ローソン', 300)],
    });
    const html = renderToString(h('div', null, tree)).replace(/<!-- -->/g, '');
    expect(html).toContain('確かめる所がないレシート 2件');
    expect(html).toMatch(/まとめて保存するレシート.*スギ薬局.*700円.*ローソン.*300円/s);
    expect(s.save).not.toHaveBeenCalled();
    find(tree, 'そろっている 2件を保存')!();
    await settle();
    await settle();
    expect(s.save).toHaveBeenCalledTimes(2);
  });

  it('1件だけなら、まとめて保存は出さない', () => {
    const tree = run({ ready: [ready('cap-1', 'スギ薬局', 700)] });
    expect(find(tree, 'そろっている 1件を保存')).toBeUndefined();
  });
});
