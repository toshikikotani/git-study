import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHookState } from '../helpers/hook-state';
import type { CaptureView } from '@/features/receipt-captures/types';

const state = vi.hoisted(() => ({
  host: null as ReturnType<typeof createHookState> | null,
  enqueue: vi.fn(),
  replace: vi.fn(),
  rescan: vi.fn(),
  resize: vi.fn(),
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
  useContext: () => null,
}));
vi.mock('react-dom', async (original) => ({
  ...(await original<typeof import('react-dom')>()),
  createPortal: (children: ReactNode) => children,
}));
vi.mock('next/link', () => ({ default: () => null }));
vi.mock('@/components/receipt/receipt-camera', () => ({ ReceiptCamera: () => null }));
vi.mock('@/features/import/receipt-queue', () => ({
  useReceiptJobs: () => [],
  enqueueReceiptFiles: (...args: unknown[]) => state.enqueue(...args),
  removeReceiptJob: vi.fn(),
  retryWaitingJobs: vi.fn(),
}));
vi.mock('@/features/import/resize-image', () => ({
  resizeToJpegBase64: (...args: unknown[]) => state.resize(...args),
}));
vi.mock('@/features/transactions/genres-client', () => ({ fetchGenreOptions: async () => [] }));
vi.mock('../../app/(app)/transactions/input-account', () => ({
  InputAccountSelector: () => null,
  useInputAccount: () => ({
    accountId: 'cash',
    selectedAccount: { id: 'cash', name: '現金' },
    accounts: [{ id: 'cash', name: '現金' }],
    setAccountId: vi.fn(),
  }),
}));
vi.mock('../../app/(app)/transactions/receipt/receipt-confirm', () => ({
  ReceiptConfirm: () => null,
}));
vi.mock('../../app/(app)/plan/actions', () => ({
  loadGoalSnapshotAction: async () => ({ snapshot: null, today: '2026-10-19' }),
}));
vi.mock('../../app/(app)/reports/fixed-cost-actions', () => ({
  markRecordFixedAction: vi.fn(),
}));
vi.mock('../../app/(app)/spending/category/actions', () => ({ createCategoryAction: vi.fn() }));
vi.mock('../../app/(app)/transactions/new/actions', () => ({
  fetchQuickEntryGenresAction: async () => [],
  fetchStoreGenresAction: async () => [],
}));
vi.mock('../../app/(app)/transactions/actions', () => ({
  saveImportBatchAction: vi.fn(),
  undoReceiptSaveAction: vi.fn(),
  recordGenreCorrectionAction: vi.fn(),
  checkReceiptDuplicatesAction: vi.fn(),
}));
vi.mock('../../app/(app)/transactions/receipt/capture-actions', () => ({
  attachCaptureToTransactionAction: vi.fn(),
  discardCaptureAction: vi.fn(),
  recordRescanAction: (...args: unknown[]) => state.rescan(...args),
  replaceCaptureImageAction: (...args: unknown[]) => state.replace(...args),
  resolveCaptureAction: vi.fn(),
  restoreCaptureAction: vi.fn(),
  saveCaptureDraftAction: vi.fn(),
  saveEditedCaptureImageAction: vi.fn(),
}));

import { ReceiptCamera } from '@/components/receipt/receipt-camera';
import { clearDraft } from '@/features/transactions/record-draft';
import { RecordSheet } from '../../app/(app)/record-sheet';
import ReceiptPage from '../../app/(app)/transactions/receipt/page';
import { CaptureEntry } from '../../app/(app)/transactions/receipt/[id]/capture-entry';

type ElementProps = {
  children?: ReactNode;
  type?: string;
  multiple?: boolean;
  capture?: string;
  href?: string;
  onClick?: () => void;
  onChange?: (event: { target: { files: File[]; value: string } }) => void;
};

function elements(tree: ReactNode): ReactElement<ElementProps>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<ElementProps>(tree)) return [];
  return [tree, ...elements(tree.props.children)];
}

function render<T>(component: () => T): T {
  state.host!.begin();
  return component();
}

function camera(tree: ReactNode) {
  return elements(tree).find((node) => node.type === ReceiptCamera) as
    ReactElement<Parameters<typeof ReceiptCamera>[0]> | undefined;
}

const capture: CaptureView = {
  id: 'capture-1',
  status: 'needs_input',
  receiptStatus: 'failed',
  imageUrl: 'https://example.test/old.jpg',
  hasEditedImage: false,
  readFields: {},
  unreadFields: ['amountYen', 'occurredOn', 'storeName'],
  draft: null,
  capturedOn: '2026-10-19',
  ocrWarnings: [],
};
const renderCapture = () =>
  render(() =>
    CaptureEntry({
      capture,
      genres: [],
      accounts: [{ id: 'cash', name: '現金' }],
      recentStores: [],
      today: '2026-10-19',
    }),
  );

beforeEach(() => {
  state.host = createHookState();
  vi.clearAllMocks();
  clearDraft();
  vi.stubGlobal('document', { body: {} });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ transactions: [], warnings: [] }),
    })),
  );
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:new-receipt');
  state.resize.mockResolvedValue('new-image-base64');
  state.replace.mockResolvedValue({ error: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Web カメラへの入口', () => {
  it('記録するの「カメラ」は外枠の Web カメラを開き、写真・スクショは複数選べる', () => {
    const onCamera = vi.fn();
    const onFiles = vi.fn();
    const tree = render(() => RecordSheet({ onClose: vi.fn(), onFiles, onCamera }));
    const button = elements(tree).find(
      (node) => node.type === 'button' && node.props.children === 'カメラ',
    );
    expect(button).toBeDefined();
    button!.props.onClick!();
    expect(onCamera).toHaveBeenCalledOnce();
    expect(onFiles).not.toHaveBeenCalled();

    const inputs = elements(tree).filter(
      (node) => node.type === 'input' && node.props.type === 'file',
    );
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.props.multiple).toBe(true);
    expect(inputs[0]!.props.capture).toBeUndefined();
    const files = [new File(['receipt'], 'receipt.jpg'), new File(['screen'], 'screen.png')];
    const event = { target: { files, value: 'selected' } };
    inputs[0]!.props.onChange!(event);
    expect(onFiles).toHaveBeenCalledExactlyOnceWith(files);
    expect(event.target.value).toBe('');
  });

  it('レシート確認の「撮る」は Web カメラを開き、撮った画像を同じ読み取りキューへ渡す', () => {
    let tree = render(ReceiptPage);
    expect(camera(tree)).toBeUndefined();
    elements(tree).find((node) => node.type === 'button' && node.props.children === '撮る')!.props
      .onClick!();
    tree = render(ReceiptPage);
    expect(camera(tree)).toBeDefined();
    const files = [new File(['receipt'], 'receipt.jpg')];
    camera(tree)!.props.onCapture(files);
    expect(state.enqueue).toHaveBeenCalledExactlyOnceWith(files);
    camera(tree)!.props.onClose();
    expect(camera(render(ReceiptPage))).toBeUndefined();

    const inputs = elements(tree).filter(
      (node) => node.type === 'input' && node.props.type === 'file',
    );
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.props.capture).toBeUndefined();
    expect(inputs[0]!.props.multiple).toBe(true);
    const gallery = [new File(['screen'], 'screen.png')];
    inputs[0]!.props.onChange!({ target: { files: gallery, value: 'selected' } });
    expect(state.enqueue).toHaveBeenLastCalledWith(gallery);
  });

  it('撮り直すと元の入力待ちの画像を差し替えて再読取し、新しいレシートは作らない', async () => {
    let tree = renderCapture();
    const retake = elements(tree).find(
      (node) => isValidElement<{ label?: string }>(node) && node.props.label === '撮り直す',
    );
    retake!.props.onClick!();
    tree = renderCapture();
    expect(camera(tree)!.props.initialMode).toBe('single');
    expect(camera(tree)!.props.singleCapture).toBe(true);
    const file = new File(['replacement'], 'replacement.jpg', { type: 'image/jpeg' });
    camera(tree)!.props.onCapture([file]);
    expect(camera(renderCapture())).toBeUndefined();
    await vi.waitFor(() => expect(state.rescan).toHaveBeenCalledOnce());
    expect(state.resize).toHaveBeenCalledExactlyOnceWith(file);
    expect(state.replace).toHaveBeenCalledExactlyOnceWith('capture-1', 'new-image-base64');
    expect(fetch).toHaveBeenCalledWith(
      '/api/import/receipt',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ image: 'new-image-base64', mediaType: 'image/jpeg' }),
      }),
    );
    expect(state.enqueue).not.toHaveBeenCalled();
    const inputs = elements(tree).filter(
      (node) => node.type === 'input' && node.props.type === 'file',
    );
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.props.capture).toBeUndefined();
  });

  it('撮り直しのカメラを閉じた場合は、画像も入力も変更しない', () => {
    const tree = renderCapture();
    const retake = elements(tree).find(
      (node) => isValidElement<{ label?: string }>(node) && node.props.label === '撮り直す',
    );
    retake!.props.onClick!();
    camera(renderCapture())!.props.onClose();
    expect(camera(renderCapture())).toBeUndefined();
    expect(state.replace).not.toHaveBeenCalled();
    expect(state.enqueue).not.toHaveBeenCalled();
  });
});
