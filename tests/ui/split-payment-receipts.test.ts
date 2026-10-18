import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TrackedSplitPayment, TrackingListResult } from '@/features/split-payments/types';
import { createHookState } from '../helpers/hook-state';
import { ledgerTx } from '../helpers/ledger';

const state = vi.hoisted(() => ({
  host: null as ReturnType<typeof createHookState> | null,
  browser: { requests: [] as TrackedSplitPayment[], error: null as string | null },
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useState']>) =>
    state.host!.hooks.useState(...args),
  useRef: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useRef']>) =>
    state.host!.hooks.useRef(...args),
  useEffect: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useEffect']>) =>
    state.host!.hooks.useEffect(...args),
}));
const actions = vi.hoisted(() => ({
  load: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  import: vi.fn(),
}));
vi.mock('../../app/(app)/spending/split-payment-tracking-actions', () => ({
  loadSplitPaymentTrackingAction: actions.load,
  updateSplitPaymentReceivedAction: actions.update,
  deleteSplitPaymentTrackingAction: actions.remove,
  importBrowserSplitPaymentTrackingAction: actions.import,
}));
const browserStore = vi.hoisted(() => ({
  use: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  imported: vi.fn(),
}));
vi.mock('@/features/split-payments/browser-store', () => ({
  useBrowserSplitPaymentTracking: browserStore.use,
  updateBrowserSplitPaymentReceived: browserStore.update,
  deleteBrowserSplitPaymentTracking: browserStore.remove,
  removeImportedBrowserSplitPayments: browserStore.imported,
}));

import { SplitPaymentReceiptList } from '../../app/(app)/_home/split-payment-receipts-list';

const userId = 'user-a';
function request(overrides: Partial<TrackedSplitPayment> = {}): TrackedSplitPayment {
  return {
    id: 'request-a',
    signature: 'signature-a',
    entries: [ledgerTx({ id: 'dinner', label: '夕食', amountYen: -3000 })],
    participants: 2,
    totalYen: 3000,
    amountPerPersonYen: 1500,
    receivedCount: 0,
    version: 1,
    createdAt: '2026-10-18T00:00:00Z',
    ...overrides,
  };
}
let initial: TrackingListResult;

type NodeProps = {
  children?: ReactNode;
  disabled?: boolean;
  checked?: boolean;
  value?: string;
  type?: string;
  'aria-label'?: string;
  onClick?: () => void | Promise<void>;
  onChange?: (event: { target: { value: string; checked: boolean } }) => void;
};
function render() {
  state.host!.begin();
  const tree = SplitPaymentReceiptList({ initial });
  state.host!.flush();
  return tree;
}
function nodes() {
  const pending: ReactNode[] = [render()];
  const result: { type: unknown; props: NodeProps }[] = [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (Array.isArray(node)) {
      pending.push(...node);
      continue;
    }
    if (!isValidElement<NodeProps>(node)) continue;
    result.push(node);
    pending.push(node.props.children);
  }
  return result;
}
const html = () => renderToStaticMarkup(render());
const button = (text: string) =>
  nodes().find((node) => node.type === 'button' && node.props.children === text)!.props;
const checkbox = () =>
  nodes().find((node) => node.type === 'input' && node.props.type === 'checkbox')!.props;
const count = () =>
  nodes().find((node) => node.type === 'input' && node.props.type === 'text')!.props;
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.clearAllMocks();
  state.host = createHookState();
  state.browser = { requests: [], error: null };
  initial = { userId, storage: 'database', requests: [request()], error: null };
  browserStore.use.mockImplementation(() => state.browser);
  browserStore.update.mockImplementation((_user, id, version, receivedCount) => {
    const updated = {
      ...state.browser.requests.find((value) => value.id === id)!,
      receivedCount,
      version: version + 1,
    };
    state.browser = {
      ...state.browser,
      requests: state.browser.requests.map((value) => (value.id === id ? updated : value)),
    };
    return updated;
  });
  browserStore.remove.mockImplementation((_user, id) => {
    state.browser = {
      ...state.browser,
      requests: state.browser.requests.filter((value) => value.id !== id),
    };
  });
  browserStore.imported.mockImplementation((_user, originals: TrackedSplitPayment[]) => {
    state.browser = {
      ...state.browser,
      requests: state.browser.requests.filter(
        (value) =>
          !originals.some((source) => source.id === value.id && source.version === value.version),
      ),
    };
  });
  actions.update.mockImplementation(async ({ receivedCount }) => ({
    userId,
    storage: 'database',
    request: request({ receivedCount, version: 2 }),
    error: null,
  }));
  actions.remove.mockResolvedValue({ error: null });
  actions.load.mockResolvedValue({ userId, storage: 'database', requests: [], error: null });
  actions.import.mockResolvedValue({
    userId,
    storage: 'database',
    requests: initial.requests,
    error: null,
  });
});

describe('ホームの割り勘の受取チェック', () => {
  it('未受取額と内容を示し、保存成功後に受取済みへ移して取り消せる', async () => {
    expect(html()).toContain('割り勘の受取待ち');
    expect(html()).toContain('夕食');
    expect(html()).toContain('未受取 1,500円');
    expect(html()).toContain('受け取った');
    checkbox().onChange!({ target: { checked: true, value: '' } });
    await settle();

    expect(actions.update).toHaveBeenCalledWith({
      id: 'request-a',
      expectedVersion: 1,
      receivedCount: 1,
    });
    expect(checkbox().checked).toBe(true);
    expect(html()).toContain('受取済み（1件）');
    checkbox().onChange!({ target: { checked: false, value: '' } });
    await settle();

    expect(actions.update).toHaveBeenLastCalledWith({
      id: 'request-a',
      expectedVersion: 2,
      receivedCount: 0,
    });
    expect(checkbox().checked).toBe(false);
    expect(html()).toContain('未受取 1,500円');
  });

  it('保存中は連打を止め、成功するまでは受け取った表示へ変えない', async () => {
    let resolve!: (value: unknown) => void;
    actions.update.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const control = checkbox();
    control.onChange!({ target: { checked: true, value: '' } });
    control.onChange!({ target: { checked: true, value: '' } });

    expect(actions.update).toHaveBeenCalledOnce();
    expect(checkbox().disabled).toBe(true);
    expect(checkbox().checked).toBe(false);
    resolve({
      userId,
      storage: 'database',
      request: request({ receivedCount: 1, version: 2 }),
      error: null,
    });
    await settle();
    expect(checkbox().disabled).toBe(false);
    expect(checkbox().checked).toBe(true);
  });

  it('失敗理由と再試行を残し、DBの失敗をブラウザの成功へ変えない', async () => {
    actions.update.mockResolvedValueOnce({
      userId,
      storage: 'database',
      request: null,
      error: '別の画面で受取状況が変更されました。',
    });
    checkbox().onChange!({ target: { checked: true, value: '' } });
    await settle();

    expect(checkbox().checked).toBe(false);
    expect(html()).toContain('role="alert"');
    expect(html()).toContain('別の画面で受取状況が変更されました');
    expect(browserStore.update).not.toHaveBeenCalled();
    button('再試行').onClick!();
    await settle();
    expect(checkbox().checked).toBe(true);
    expect(html()).not.toContain('別の画面で受取状況が変更されました');
  });

  it('通信例外のときもチェックを維持し、再試行できる', async () => {
    actions.update.mockRejectedValueOnce(new Error('failed to fetch'));
    checkbox().onChange!({ target: { checked: true, value: '' } });
    await settle();
    expect(checkbox().checked).toBe(false);
    expect(checkbox().disabled).toBe(false);
    expect(html()).toContain('接続を確認');
    expect(button('再試行').disabled).toBe(false);
  });

  it('競合時は最新の受取状況を読み直してから新しいversionで保存できる', async () => {
    actions.update.mockResolvedValueOnce({
      userId,
      storage: 'database',
      request: null,
      error: '別の画面で受取状況が変更されました。',
    });
    checkbox().onChange!({ target: { checked: true, value: '' } });
    await settle();
    actions.load.mockResolvedValueOnce({
      userId,
      storage: 'database',
      requests: [request({ version: 4 })],
      error: null,
    });
    button('最新の状況を読み込む').onClick!();
    await settle();
    expect(html()).not.toContain('別の画面で受取状況が変更されました');
    checkbox().onChange!({ target: { checked: true, value: '' } });
    await settle();
    expect(actions.update).toHaveBeenLastCalledWith({
      id: 'request-a',
      expectedVersion: 4,
      receivedCount: 1,
    });
  });

  it('一部受取の人数を反映し、残額と受取人数を再計算する', async () => {
    initial.requests = [request({ participants: 4, amountPerPersonYen: 750, receivedCount: 1 })];
    actions.update.mockImplementationOnce(async ({ receivedCount }) => ({
      userId,
      storage: 'database',
      request: request({ participants: 4, amountPerPersonYen: 750, receivedCount, version: 2 }),
      error: null,
    }));
    expect(html()).toContain('全員から受け取った');
    expect(html()).toContain('未受取 1,500円');
    count().onChange!({ target: { checked: false, value: '2' } });
    button('反映').onClick!();
    await settle();

    expect(actions.update).toHaveBeenCalledWith({
      id: 'request-a',
      expectedVersion: 1,
      receivedCount: 2,
    });
    expect(html()).toContain('未受取 750円');
    expect(html()).toContain('2 / 3人から受取済み');
    expect(checkbox().checked).toBe(false);
  });

  it.each(['', '-1', '1.5', '2', '9007199254740992'])(
    '範囲外の受取人数 %j を反映しない',
    (value) => {
      count().onChange!({ target: { checked: false, value } });
      expect(button('反映').disabled).toBe(true);
      button('反映').onClick!();
      expect(actions.update).not.toHaveBeenCalled();
    },
  );

  it('追跡の削除は確認してから行い、失敗しても明細と受取チェックを残す', async () => {
    actions.remove.mockResolvedValueOnce({ error: '削除できませんでした。' });
    button('受取チェックを削除').onClick!();
    expect(html()).toContain('明細は残ります');
    expect(actions.remove).not.toHaveBeenCalled();
    button('削除する').onClick!();
    await settle();
    expect(html()).toContain('夕食');
    expect(html()).toContain('削除できませんでした');
    button('再試行').onClick!();
    await settle();
    expect(render()).toBeNull();
  });

  it('DB未導入なら本人のブラウザ保存を示し、同じ記録を更新する', async () => {
    initial = { ...initial, storage: 'browser', requests: [] };
    state.browser.requests = [request()];
    expect(html()).toContain('このブラウザに保存');
    checkbox().onChange!({ target: { checked: true, value: '' } });
    await settle();
    expect(browserStore.update).toHaveBeenCalledWith(userId, 'request-a', 1, 1);
    expect(checkbox().checked).toBe(true);
    expect(actions.update).not.toHaveBeenCalled();
  });

  it('空ならカードを表示せず、認証できない場合はローカルの記録を読ませない', () => {
    initial.requests = [];
    expect(render()).toBeNull();
    initial = { ...initial, userId: null };
    state.browser.requests = [request()];
    expect(render()).toBeNull();
    expect(browserStore.use).toHaveBeenLastCalledWith(null);
  });

  it('取得失敗だけの場合も再読み込みを出して、回復後は消す', async () => {
    initial = { ...initial, requests: [], error: '受取状況を取得できませんでした。' };
    expect(html()).toContain('role="alert"');
    button('再読み込み').onClick!();
    await settle();
    expect(render()).toBeNull();
  });

  it('ローカルとDBに同じ依頼があればDBを優先し、引き継ぎ成功時だけローカルを削除する', async () => {
    const local = request({ id: 'browser-a' });
    state.browser.requests = [local];
    expect(html().match(/<li class="rounded-2xl p-4"/g)).toHaveLength(1);
    expect(checkbox().checked).toBe(false);
    expect(browserStore.imported).not.toHaveBeenCalled();
    await settle();
    expect(actions.import).toHaveBeenCalledWith([local]);
    expect(browserStore.imported).toHaveBeenCalledWith(userId, [local]);
    expect(checkbox().checked).toBe(false);
  });

  it('引き継ぎ失敗時はローカルを維持し、明示的な再試行で回復する', async () => {
    const local = request({
      id: 'browser-b',
      signature: 'signature-b',
      entries: [ledgerTx({ id: 'taxi-entry', label: 'タクシー' })],
    });
    state.browser.requests = [local];
    actions.import.mockResolvedValueOnce({
      userId,
      storage: 'database',
      requests: [],
      error: '引き継げませんでした。',
    });
    html();
    await settle();
    expect(html()).toContain('引き継げませんでした');
    expect(html()).toContain('タクシー');
    expect(browserStore.imported).not.toHaveBeenCalled();
    expect(checkbox().disabled).toBe(false);
    button('引き継ぎを再試行').onClick!();
    render();
    await settle();
    expect(actions.import).toHaveBeenCalledTimes(2);
    expect(browserStore.imported).toHaveBeenCalledWith(userId, [local]);
  });

  async function importWithConcurrentChange() {
    const local = request({ id: 'browser-a' });
    state.browser.requests = [local];
    let resolve!: (value: TrackingListResult) => void;
    actions.import.mockReturnValueOnce(
      new Promise<TrackingListResult>((done) => {
        resolve = done;
      }),
    );
    render();
    await settle();
    state.browser = { requests: [{ ...local, receivedCount: 1, version: 2 }], error: null };
    render();
    resolve({ userId, storage: 'database', requests: [request({ version: 2 })], error: null });
    await settle();
    render();
  }

  it('取り込み中の別タブ更新を消さずに表示し、明示的にDBの最新versionへ反映する', async () => {
    await importWithConcurrentChange();
    expect(html()).toContain('このブラウザに未反映の受取状況があります');
    expect(state.browser.requests).toHaveLength(1);
    expect(actions.import).toHaveBeenCalledOnce();

    // revalidatePathによる新しい初期値が来ても、未反映の記録を隠さない。
    initial = { ...initial, requests: [request({ version: 2 })] };
    render();
    expect(html()).toContain('このブラウザに未反映の受取状況があります');
    actions.update.mockResolvedValueOnce({
      userId,
      storage: 'database',
      request: request({ receivedCount: 1, version: 3 }),
      error: null,
    });
    button('このブラウザの受取人数を反映').onClick!();
    await settle();

    expect(actions.update).toHaveBeenCalledWith({
      id: 'request-a',
      expectedVersion: 2,
      receivedCount: 1,
    });
    expect(browserStore.remove).toHaveBeenCalledWith(userId, 'browser-a', 2);
    expect(state.browser.requests).toHaveLength(0);
    expect(html()).not.toContain('このブラウザに未反映');
    expect(checkbox().checked).toBe(true);
  });

  it('アカウントを使う選択ではDBの人数を変更せず、確認したローカルだけ削除する', async () => {
    await importWithConcurrentChange();
    button('アカウントの受取状況を使う').onClick!();
    await settle();
    expect(actions.update).not.toHaveBeenCalled();
    expect(browserStore.remove).toHaveBeenCalledWith(userId, 'browser-a', 2);
    expect(checkbox().checked).toBe(false);
    expect(html()).not.toContain('このブラウザに未反映');
  });

  it('未反映人数のDB保存に失敗した場合はローカルを削除しない', async () => {
    await importWithConcurrentChange();
    actions.update.mockResolvedValueOnce({
      userId,
      storage: 'database',
      request: null,
      error: '別の画面で受取状況が変更されました。',
    });
    button('このブラウザの受取人数を反映').onClick!();
    await settle();
    expect(browserStore.remove).not.toHaveBeenCalled();
    expect(state.browser.requests).toHaveLength(1);
    expect(html()).toContain('このブラウザに未反映');
    expect(html()).toContain('別の画面で受取状況が変更されました');
  });

  it('ページを開き直しても人数の違うローカルを見せ、サーバーが返した競合記録を削除しない', async () => {
    initial.requests = [request({ receivedCount: 1, version: 4 })];
    const local = request({ id: 'browser-a', receivedCount: 0, version: 3 });
    state.browser.requests = [local];
    actions.import.mockResolvedValue({
      userId,
      storage: 'database',
      requests: initial.requests,
      error: null,
      conflicts: [local.signature],
    });
    expect(html()).toContain('このブラウザに未反映の受取状況があります');
    await settle();
    expect(browserStore.imported).not.toHaveBeenCalled();
    expect(state.browser.requests).toEqual([local]);

    state.host = createHookState();
    expect(html()).toContain('このブラウザに未反映の受取状況があります');
    await settle();
    expect(browserStore.imported).not.toHaveBeenCalled();
    expect(state.browser.requests).toEqual([local]);
  });

  it('101件以上のブラウザ保存は100件ごとに引き継ぐ', async () => {
    initial = { ...initial, requests: [] };
    state.browser.requests = Array.from({ length: 101 }, (_, index) =>
      request({ id: `browser-${index}`, signature: `signature-${index}` }),
    );
    render();
    await settle();
    await settle();
    expect(actions.import).toHaveBeenCalledTimes(2);
    expect(
      actions.import.mock.calls.map(([batch]) => (batch as TrackedSplitPayment[]).length),
    ).toEqual([100, 1]);
    expect(state.browser.requests).toHaveLength(0);
  });
});
