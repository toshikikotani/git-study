import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReceiptCamera } from '@/components/receipt/receipt-camera';
import { CAMERA_PATH } from '@/features/receipt-captures/camera-entry';

const state = vi.hoisted(() => ({
  camera: null as Parameters<typeof ReceiptCamera>[0] | null,
  enqueue: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: state.replace }) }));
vi.mock('@/features/import/receipt-queue', () => ({
  enqueueReceiptFiles: (...args: unknown[]) => state.enqueue(...args),
}));
vi.mock('@/components/receipt/receipt-camera', () => ({
  ReceiptCamera: (props: Parameters<typeof ReceiptCamera>[0]) => {
    state.camera = props;
    return h('div', { role: 'dialog', 'aria-label': 'レシートを撮影' });
  },
}));

import CameraPage from '../../app/(app)/camera/page';
import manifest from '../../app/manifest';

beforeEach(() => {
  vi.clearAllMocks();
  state.camera = null;
});

describe('カメラURLからの起動', () => {
  it('入口を開くと、追加の撮影ボタンを挟まずWebカメラを表示する', () => {
    const html = renderToString(h(CameraPage));
    expect(html).toContain('aria-label="レシートを撮影"');
    expect(state.camera).not.toBeNull();
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.replace).not.toHaveBeenCalled();
  });

  it('連続撮影は既存の読み取りへ順に渡し、完了までカメラから移動しない', () => {
    renderToString(h(CameraPage));
    const first = new File(['one'], 'first.jpg', { type: 'image/jpeg' });
    const second = new File(['two'], 'second.jpg', { type: 'image/jpeg' });
    state.camera!.onCapture([first]);
    state.camera!.onCapture([second]);
    expect(state.enqueue.mock.calls).toEqual([[[first]], [[second]]]);
    expect(state.replace).not.toHaveBeenCalled();
    state.camera!.onClose();
    expect(state.replace).toHaveBeenCalledExactlyOnceWith('/spending');
  });

  it('撮影せず閉じた場合も明細を開き、空の画像を取り込まない', () => {
    renderToString(h(CameraPage));
    state.camera!.onClose();
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.replace).toHaveBeenCalledExactlyOnceWith('/spending');
  });

  it('ホーム画面の撮影ショートカットも同じ入口を使い、通常の起動先を保つ', () => {
    const info = manifest();
    expect(info.shortcuts!.find((shortcut) => shortcut.short_name === '撮影')!.url).toBe(
      CAMERA_PATH,
    );
    expect(CAMERA_PATH).toBe('/camera');
    expect(info.start_url).toBe('/spending');
    expect(info.shortcuts!.find((shortcut) => shortcut.short_name === '手入力')!.url).toBe(
      '/spending?record=1',
    );
  });
});
