import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHookState } from '../helpers/hook-state';
import * as documentDetect from '@/features/import/document-detect';

const state = vi.hoisted(() => ({
  host: null as ReturnType<typeof createHookState> | null,
  cleanups: [] as (() => void)[],
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useState']>) =>
    state.host!.hooks.useState(...args),
  useRef: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useRef']>) =>
    state.host!.hooks.useRef(...args),
  useMemo: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useMemo']>) =>
    state.host!.hooks.useMemo(...args),
  useCallback: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useCallback']>) =>
    state.host!.hooks.useCallback(...args),
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) =>
    state.host!.hooks.useEffect(() => {
      const cleanup = effect();
      if (cleanup) state.cleanups.push(cleanup);
      return cleanup;
    }, deps),
}));
vi.mock('@/components/receipt/camera-link', () => ({ CameraLink: () => null }));

import { ReceiptCamera } from '@/components/receipt/receipt-camera';

type Props = {
  children?: ReactNode;
  disabled?: boolean;
  capture?: string;
  multiple?: boolean;
  className?: string;
  viewBox?: string;
  preserveAspectRatio?: string;
  x?: number;
  width?: number;
  'aria-label'?: string;
  ref?: { current: unknown };
  onClick?: () => void;
  onChange?: (event: { target: { files: FileList; value: string } }) => void;
  onResize?: (event: { currentTarget: typeof video }) => void;
};
const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>();
const play = vi.fn<() => Promise<void>>();
const onCapture = vi.fn();
const onClose = vi.fn();
const drawImage = vi.fn();
const toBlob = vi.fn<(callback: (blob: Blob | null) => void) => void>();
let mode: 'single' | 'continuous' | 'long';
let singleCapture: boolean;
let video: {
  videoWidth: number;
  videoHeight: number;
  srcObject: MediaStream | null;
  play: typeof play;
};
let body: { style: { overflow: string } };

function stream() {
  const stop = vi.fn();
  const listeners = new Map<string, () => void>();
  const track = {
    stop,
    addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  return {
    value: { getTracks: () => [track] } as unknown as MediaStream,
    stop,
    end: () => listeners.get('ended')?.(),
  };
}
function descendants(tree: ReactNode) {
  const pending: ReactNode[] = [tree];
  const found: { type: unknown; props: Props }[] = [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (Array.isArray(node)) pending.push(...node);
    else if (isValidElement<Props>(node)) {
      found.push(node);
      pending.push(node.props.children);
    }
  }
  return found;
}
function render() {
  state.host!.begin();
  const tree = ReceiptCamera({ onCapture, onClose, initialMode: mode, singleCapture });
  const view = descendants(tree).find((node) => node.type === 'video');
  if (view) view.props.ref!.current = video;
  state.host!.flush();
  return tree;
}
const html = () => renderToStaticMarkup(render());
const nodes = () => descendants(render());
const button = (name: string) =>
  nodes().find(
    (node) =>
      node.type === 'button' && (node.props['aria-label'] === name || node.props.children === name),
  )!.props;
async function settle() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}
function unmount() {
  const cleanups = state.cleanups;
  state.cleanups = [];
  cleanups.forEach((cleanup) => cleanup());
}

beforeEach(() => {
  state.host = createHookState();
  state.cleanups = [];
  vi.clearAllMocks();
  vi.useFakeTimers();
  mode = 'single';
  singleCapture = false;
  play.mockResolvedValue(undefined);
  video = { videoWidth: 1200, videoHeight: 1800, srcObject: null, play };
  body = { style: { overflow: 'auto' } };
  getUserMedia.mockResolvedValue(stream().value);
  toBlob.mockImplementation((callback) => callback(new Blob(['receipt'], { type: 'image/jpeg' })));
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('localStorage', { getItem: () => 'off', setItem: vi.fn() });
  vi.stubGlobal('window', { setInterval, clearInterval });
  vi.stubGlobal('document', {
    body,
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage,
        getImageData: () => ({ data: new Uint8ClampedArray(240 * 360 * 4) }),
      }),
      toBlob,
    }),
  });
});
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Webカメラの開始と終了', () => {
  it('保存済みの自動オフはマウント後に適用し、最初のHTMLをサーバーと一致させる', () => {
    const first = renderToStaticMarkup(render());
    expect(first).toContain('自動 オン');
    expect(html()).toContain('自動 オフ');
  });

  it('背面Webカメラを開き、動画再生後に撮影できるようにする', async () => {
    render();
    expect(button('シャッター').disabled).toBe(true);
    expect(body.style.overflow).toBe('hidden');
    await settle();
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({
      video: { facingMode: 'environment', width: { ideal: 1920 } },
      audio: false,
    });
    expect(play).toHaveBeenCalledOnce();
    expect(button('シャッター').disabled).toBe(false);
    expect(html()).toContain('data-no-pull');
  });

  it.each(['close', 'unmount'])(
    '権限応答の前に%sしたら、遅れて届く映像も停止する',
    async (action) => {
      let resolve!: (value: MediaStream) => void;
      getUserMedia.mockReturnValueOnce(new Promise((done) => (resolve = done)));
      render();
      if (action === 'close') button('閉じる').onClick!();
      else unmount();
      const pending = stream();
      resolve(pending.value);
      await settle();
      expect(pending.stop).toHaveBeenCalledOnce();
      expect(play).not.toHaveBeenCalled();
      expect(onCapture).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(action === 'close' ? 1 : 0);
    },
  );

  it('閉じると映像を切り離して停止し、破棄時にページのスクロールを戻す', async () => {
    const live = stream();
    getUserMedia.mockResolvedValueOnce(live.value);
    render();
    await settle();
    button('閉じる').onClick!();
    button('閉じる').onClick!();
    expect(live.stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(body.style.overflow).toBe('auto');
  });

  it('再生失敗も捕捉してカメラを停止し、ユーザー操作で再試行する', async () => {
    const first = stream();
    getUserMedia.mockResolvedValueOnce(first.value);
    play.mockRejectedValueOnce(new Error('play blocked'));
    render();
    await settle();
    expect(html()).toContain('カメラを開けませんでした');
    expect(first.stop).toHaveBeenCalledOnce();
    expect(button('シャッター').disabled).toBe(true);
    const second = stream();
    getUserMedia.mockResolvedValueOnce(second.value);
    button('もう一度カメラを開く').onClick!();
    render();
    await settle();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(button('シャッター').disabled).toBe(false);
    expect(video.srcObject).toBe(second.value);
    expect(html()).not.toContain('カメラを開けませんでした');
  });

  it('端末が映像を停止したら再試行を案内し、撮影可能なままにしない', async () => {
    const live = stream();
    getUserMedia.mockResolvedValueOnce(live.value);
    render();
    await settle();
    live.end();
    expect(button('シャッター').disabled).toBe(true);
    expect(html()).toContain('カメラが停止しました');
    expect(button('もう一度カメラを開く')).toBeDefined();
    expect(live.stop).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('映像・検出枠・保存画像で同じ座標を使い、回転後も比率を更新する', async () => {
    vi.spyOn(documentDetect, 'detectDocument').mockReturnValue({
      box: { x0: 0.2, x1: 0.8, y0: 0.1, y1: 0.9 },
      coverage: 0.48,
      confidence: 1,
    });
    render();
    await settle();
    render();
    await vi.advanceTimersByTimeAsync(250);
    const view = nodes().find((node) => node.type === 'video')!.props;
    expect(view.className).toContain('object-contain');
    const overlay = nodes().find((node) => node.type === 'svg' && node.props.viewBox)!.props;
    expect(overlay.viewBox).toBe('0 0 1200 1800');
    expect(overlay.preserveAspectRatio).toBe('xMidYMid meet');
    const rect = nodes().find((node) => node.type === 'rect')!.props;
    expect(rect.x).toBe(240);
    expect(rect.width).toBeCloseTo(720);
    drawImage.mockClear();
    button('シャッター').onClick!();
    await settle();
    const crop = documentDetect.cropRect({ x0: 0.2, x1: 0.8, y0: 0.1, y1: 0.9 }, 1200, 1800);
    expect(drawImage).toHaveBeenCalledWith(
      video,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );
    // 別の撮影セッションで端末回転を再現する。
    unmount();
    state.host = createHookState();
    render();
    await settle();
    render();
    await vi.advanceTimersByTimeAsync(250);
    video.videoWidth = 1800;
    video.videoHeight = 1200;
    nodes().find((node) => node.type === 'video')!.props.onResize!({ currentTarget: video });
    expect(nodes().find((node) => node.type === 'svg' && node.props.viewBox)!.props.viewBox).toBe(
      '0 0 1800 1200',
    );
  });

  it.each(['denied', 'unsupported'])(
    'カメラ不可 (%s) でも勝手に標準カメラを開かずライブラリを残す',
    async (reason) => {
      if (reason === 'denied') getUserMedia.mockRejectedValueOnce(new Error('denied'));
      else vi.stubGlobal('navigator', {});
      render();
      await settle();
      expect(html()).toContain('カメラを開けませんでした');
      expect(onClose).not.toHaveBeenCalled();
      const input = nodes().find((node) => node.type === 'input')!.props;
      expect(input.capture).toBeUndefined();
      const file = new File(['photo'], 'receipt.jpg', { type: 'image/jpeg' });
      input.onChange!({ target: { files: [file] as unknown as FileList, value: 'receipt.jpg' } });
      expect(onCapture).toHaveBeenCalledExactlyOnceWith([file]);
      expect(onClose).toHaveBeenCalledOnce();
    },
  );
});

describe('撮影の競合と既存モード', () => {
  it('撮り直しでは連続モードを出さず、写真も一枚だけ選べる', async () => {
    singleCapture = true;
    mode = 'continuous';
    render();
    await settle();
    expect(nodes().some((node) => node.type === 'button' && node.props.children === '連続')).toBe(
      false,
    );
    expect(nodes().find((node) => node.type === 'input')!.props.multiple).toBe(false);
    expect(button('長いレシート')).toBeDefined();
    button('シャッター').onClick!();
    await settle();
    expect(onCapture).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('描画前にシャッターを連打しても、一枚だけを読み取りへ渡す', async () => {
    let finish!: (blob: Blob) => void;
    toBlob.mockImplementationOnce((callback) => (finish = callback));
    render();
    await settle();
    const shutter = button('シャッター');
    shutter.onClick!();
    shutter.onClick!();
    expect(toBlob).toHaveBeenCalledOnce();
    finish(new Blob(['receipt'], { type: 'image/jpeg' }));
    await settle();
    expect(onCapture).toHaveBeenCalledOnce();
    expect(onCapture.mock.calls[0]![0][0]).toBeInstanceOf(File);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('画像化の完了前に閉じたら、後から明細を追加しない', async () => {
    let finish!: (blob: Blob) => void;
    toBlob.mockImplementationOnce((callback) => (finish = callback));
    render();
    await settle();
    button('シャッター').onClick!();
    button('閉じる').onClick!();
    finish(new Blob(['receipt']));
    await settle();
    expect(onCapture).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('連続モードでは撮影後もカメラを残し、完了で停止する', async () => {
    mode = 'continuous';
    const live = stream();
    getUserMedia.mockResolvedValueOnce(live.value);
    render();
    await settle();
    button('シャッター').onClick!();
    await settle();
    button('シャッター').onClick!();
    await settle();
    expect(onCapture).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
    expect(html()).toContain('2枚撮影済み');
    expect(live.stop).not.toHaveBeenCalled();
    button('完了').onClick!();
    expect(live.stop).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('長いレシートは撮影をためて一枚につなげる', async () => {
    mode = 'long';
    const closeBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', async () => ({
      width: 1200,
      height: 1800,
      close: closeBitmap,
    }));
    render();
    await settle();
    button('シャッター').onClick!();
    await settle();
    button('シャッター').onClick!();
    await settle();
    expect(onCapture).not.toHaveBeenCalled();
    expect(html()).toContain('2枚目まで撮影済み');
    const done = button('つなげて完了');
    done.onClick!();
    done.onClick!();
    await settle();
    expect(onCapture).toHaveBeenCalledOnce();
    expect(onCapture.mock.calls[0]![0]).toHaveLength(1);
    expect(closeBitmap).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
