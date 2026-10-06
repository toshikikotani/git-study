import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/import/resize-image', () => ({
  resizeToJpegBase64: vi.fn(async () => 'BASE64'),
}));
const saved = new Map<string, unknown>();
vi.mock('@/features/import/offline-store', () => ({
  saveWaitingFile: vi.fn(async (e: { id: string }) => void saved.set(e.id, e)),
  deleteWaitingFile: vi.fn(async (id: string) => void saved.delete(id)),
  loadWaitingFiles: vi.fn(async () => [...saved.values()]),
}));

import {
  configureReceiptQueue,
  enqueueReceiptFiles,
  getReceiptJobs,
  queueReducer,
  newJob,
  removeReceiptJob,
} from '@/features/import/receipt-queue';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('F7: 読み取りキューの状態遷移', () => {
  const a = newJob('a', 'blob:a', 1);
  it('waiting → retry → captured の順に遷移する(圏外は失敗ではない)', () => {
    let s = queueReducer([a], { type: 'waiting', id: 'a' });
    expect(s[0]!.status).toBe('waiting');
    expect(s[0]!.error).toBeNull();
    s = queueReducer(s, { type: 'retry', id: 'a' });
    expect(s[0]!.status).toBe('reading');
    s = queueReducer(s, { type: 'captured', id: 'a', captureId: 'c1', receiptStatus: 'failed' });
    expect(s[0]).toMatchObject({ status: 'needs_input', captureId: 'c1', receiptStatus: 'failed' });
  });
});

describe('F7: オフラインで撮ったレシート(受け入れ基準18)', () => {
  const online = vi.fn(() => true);
  const listeners: Record<string, () => void> = {};

  beforeEach(() => {
    saved.clear();
    vi.stubGlobal('navigator', {
      get onLine() {
        return online();
      },
    });
    vi.stubGlobal('window', {
      addEventListener: (name: string, fn: () => void) => void (listeners[name] = fn),
    });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
  });
  afterEach(() => {
    for (const j of getReceiptJobs()) removeReceiptJob(j.id);
    vi.unstubAllGlobals();
  });

  it('圏外で撮ったら失敗ではなく「読み取り待ち」になり、画像は端末に残る', async () => {
    online.mockReturnValue(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const [id] = enqueueReceiptFiles([new File(['x'], 'r.jpg', { type: 'image/jpeg' })]);
    await tick();
    await tick();
    expect(getReceiptJobs().find((j) => j.id === id)).toMatchObject({
      status: 'waiting',
      error: null,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(saved.has(id!)).toBe(true);
  });

  it('オンラインに戻ると自動で再読み取りされ、読めなければ入力待ちになる(画像は端末から片付く)', async () => {
    online.mockReturnValue(false);
    const createCapture = vi.fn(async () => ({
      error: null as null,
      receiptStatus: 'failed' as const,
      captureId: 'cap-1',
    }));
    configureReceiptQueue({ createCapture });
    const [id] = enqueueReceiptFiles([new File(['x'], 'r.jpg', { type: 'image/jpeg' })]);
    await tick();
    await tick();
    expect(getReceiptJobs()[0]!.status).toBe('waiting');

    // 復帰:読み取り結果は空(読めない)
    online.mockReturnValue(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ transactions: [], warnings: ['読めません'] }),
      })),
    );
    listeners.online?.();
    await tick();
    await tick();
    await tick();
    expect(createCapture).toHaveBeenCalledTimes(1);
    expect(getReceiptJobs().find((j) => j.id === id)).toMatchObject({
      status: 'needs_input',
      captureId: 'cap-1',
    });
    expect(saved.has(id!)).toBe(false);
  });

  it('通信できない(fetch が例外)ときも「失敗」にせず読み取り待ち', async () => {
    online.mockReturnValue(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network');
      }),
    );
    enqueueReceiptFiles([new File(['x'], 'r.jpg', { type: 'image/jpeg' })]);
    await tick();
    await tick();
    expect(getReceiptJobs()[0]!.status).toBe('waiting');
  });
});
