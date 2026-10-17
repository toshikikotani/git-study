import { createElement as h, isValidElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHookState } from '../helpers/hook-state';
import { buildFromAiRows } from '@/features/import/receipt-ai';
import { newJob } from '@/features/import/receipt-queue';

const state = vi.hoisted(() => ({
  host: null as ReturnType<typeof createHookState> | null,
  duplicates: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useState']>) =>
    state.host!.hooks.useState(...args),
  useEffect: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useEffect']>) =>
    state.host!.hooks.useEffect(...args),
  useMemo: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useMemo']>) =>
    state.host!.hooks.useMemo(...args),
  useCallback: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useCallback']>) =>
    state.host!.hooks.useCallback(...args),
}));
vi.mock('../../app/(app)/transactions/actions', () => ({
  checkReceiptDuplicatesAction: (...args: unknown[]) => state.duplicates(...args),
}));
vi.mock('@/components/receipt/zoomable-image', () => ({ ZoomableImage: () => null }));
import { ReceiptConfirm } from '../../app/(app)/transactions/receipt/receipt-confirm';

const parsed = buildFromAiRows([
  {
    occurred_on: '2026-10-17',
    amount_yen: 500,
    store_name: 'お店',
    payment_method_text: '',
    items: [
      {
        name: 'お茶',
        amount_yen: 500,
        product_type: '',
        tax_rate: 10,
        is_discount: false,
        confidence: 1,
        y_ratio: 0.4,
      },
    ],
    expense_subtype: '',
    price_basis: 'tax_included',
    tax_8_yen: 0,
    tax_10_yen: 0,
    points_used_yen: 0,
    coupon_yen: 0,
    store_confidence: 1,
    date_confidence: 1,
    total_confidence: 1,
  },
]).transactions[0]!;
const job = {
  ...newJob('job', 'blob:receipt', 0),
  status: 'ready' as const,
  parsed: [parsed],
  parentGenreIds: { 0: 'food' },
};
const onSave = vi.fn();
let options: Partial<Parameters<typeof ReceiptConfirm>[0]>;
const props = (): Parameters<typeof ReceiptConfirm>[0] => ({
  job,
  index: 0,
  genres: [{ id: 'food', name: '食費' }],
  accountId: 'cash',
  saving: false,
  savedLabel: null,
  goal: null,
  onSave,
  onDiscard: vi.fn(),
  ...options,
});
function render() {
  state.host!.begin();
  const html = renderToString(h(ReceiptConfirm, props()));
  state.host!.flush();
  return html;
}

function findButton(node: ReactNode, label: string): (() => void) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, label);
      if (found) return found;
    }
    return;
  }
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return;
  if (node.type === 'button' && node.props.children === label) return node.props.onClick;
  return findButton(node.props.children, label);
}
beforeEach(() => {
  state.host = createHookState();
  options = {};
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  state.duplicates.mockResolvedValue({ duplicates: {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('自動保存前の情報確認', () => {
  it.each(['2026-10-16', '2026-10-17'])(
    '未来日・高額の確認は主ボタン一回で保存する(%s)',
    (today) => {
      state.host!.begin();
      const tree = ReceiptConfirm({
        job,
        index: 0,
        genres: [{ id: 'food', name: '食費' }],
        accountId: 'cash',
        saving: false,
        savedLabel: null,
        onSave,
        onDiscard: vi.fn(),
        goal: {
          today,
          snapshot: {
            range: { from: '2026-10-01', to: '2026-11-01' },
            genres: [{ genreId: 'food', genreName: '食費', targetYen: 800, spentYen: 0 }],
          },
        },
      });
      const save = findButton(tree, '目標に含めて保存');
      expect(save).toBeDefined();
      save!();
      expect(onSave).toHaveBeenCalledOnce();
      expect(onSave.mock.calls[0]![0].plan.transaction.kind).toBe('normal');
    },
  );

  it('重複照会が終わるまで保存せず、重複がなければ保存する', async () => {
    let resolve!: (value: { duplicates: object }) => void;
    state.duplicates.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render();
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.duplicates).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
    resolve({ duplicates: {} });
    await Promise.resolve();
    render();
    await vi.advanceTimersByTimeAsync(300);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('重複があると自動保存せず、警告と手動保存を残す', async () => {
    state.duplicates.mockResolvedValue({ duplicates: { r: [{ id: 'existing' }] } });
    render();
    await vi.advanceTimersByTimeAsync(400);
    const html = render();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSave).not.toHaveBeenCalled();
    expect(html).toContain('二重登録でないか確認してください');
    expect(html).toContain('保存する');
  });

  it('目標の読込中・保存先なし・明示確認が必要な未来日は自動保存しない', async () => {
    options = { autoSaveReady: false };
    render();
    await vi.advanceTimersByTimeAsync(400);
    render();
    await vi.advanceTimersByTimeAsync(300);
    expect(onSave).not.toHaveBeenCalled();
    options = { accountId: '' };
    render();
    await vi.advanceTimersByTimeAsync(300);
    expect(onSave).not.toHaveBeenCalled();
    options = {
      goal: {
        today: '2026-10-16',
        snapshot: { range: { from: '2026-10-01', to: '2026-11-01' }, genres: [] },
      },
    };
    const html = render();
    await vi.advanceTimersByTimeAsync(300);
    expect(onSave).not.toHaveBeenCalled();
    expect(html).toContain('目標に含めて保存');
  });

  it('照会の通信失敗では自動保存せず、入力と手動保存を残す', async () => {
    state.duplicates.mockRejectedValue(new Error('offline'));
    render();
    await vi.advanceTimersByTimeAsync(400);
    const html = render();
    await vi.advanceTimersByTimeAsync(300);
    expect(onSave).not.toHaveBeenCalled();
    expect(html).toContain('重複を確認できませんでした');
    expect(html).toContain('保存する');
  });

  it('DBエラーを重複なしと扱わず、手動保存と再確認を残し、再確認の成功後だけ自動保存する', async () => {
    state.duplicates
      .mockResolvedValueOnce({ duplicates: {}, error: '重複を確認できませんでした。' })
      .mockResolvedValue({ duplicates: {}, error: null });
    render();
    await vi.advanceTimersByTimeAsync(400);
    const html = render();
    await vi.advanceTimersByTimeAsync(300);
    expect(onSave).not.toHaveBeenCalled();
    expect(html).toContain('重複をもう一度確認する');
    expect(html).toContain('保存する');
    state.host!.begin();
    const retry = findButton(ReceiptConfirm(props()), '重複をもう一度確認する');
    expect(retry).toBeDefined();
    retry!();
    render();
    await vi.advanceTimersByTimeAsync(400);
    render();
    await vi.advanceTimersByTimeAsync(300);
    expect(state.duplicates).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('DBエラーが残っていても、本人の手動保存は実行できる', async () => {
    state.duplicates.mockResolvedValue({ duplicates: {}, error: '重複を確認できませんでした。' });
    render();
    await vi.advanceTimersByTimeAsync(400);
    render();
    state.host!.begin();
    const save = findButton(ReceiptConfirm(props()), '保存する');
    expect(save).toBeDefined();
    save!();
    expect(onSave).toHaveBeenCalledOnce();
  });
});
