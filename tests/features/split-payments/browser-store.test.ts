import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteBrowserSplitPaymentTracking,
  readBrowserSplitPaymentTracking,
  removeImportedBrowserSplitPayments,
  saveBrowserSplitPaymentTracking,
  updateBrowserSplitPaymentReceived,
} from '@/features/split-payments/browser-store';
import type { TrackedSplitPayment } from '@/features/split-payments/types';
import { buildSplitPaymentRequest } from '@/domain/split-payment-request';
import { ledgerTx } from '../../helpers/ledger';

const owner = '11111111-1111-1111-1111-111111111111';
const other = '22222222-2222-2222-2222-222222222222';
const request: TrackedSplitPayment = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  signature: 'a'.repeat(64),
  entries: buildSplitPaymentRequest(
    [ledgerTx({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', amountYen: -3001 })],
    3,
  ).entries,
  participants: 3,
  totalYen: 3001,
  amountPerPersonYen: 1000,
  receivedCount: 0,
  version: 0,
  createdAt: '2026-10-18T00:00:00.000Z',
};
let data: Map<string, string>;
let local: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };
beforeEach(() => {
  data = new Map();
  local = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
  };
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('window', { localStorage: local, dispatchEvent: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe('DB未適用時の受取待ちを本人のブラウザに保存する', () => {
  it('Web Locksで別タブと同時の更新を直列にし、古いversionを拒否する', async () => {
    let tail = Promise.resolve();
    const lock = vi.fn((_name: string, operation: () => unknown) => {
      const result = tail.then(operation);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    });
    vi.stubGlobal('navigator', { locks: { request: lock } });
    await saveBrowserSplitPaymentTracking(owner, request);
    const results = await Promise.allSettled([
      updateBrowserSplitPaymentReceived(owner, request.id, 0, 1),
      updateBrowserSplitPaymentReceived(owner, request.id, 0, 2),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(readBrowserSplitPaymentTracking(owner).requests[0]?.receivedCount).toBe(1);
    expect(lock).toHaveBeenCalledTimes(3);
  });
  it('再読み込み後も保持し、同じブラウザの他人には見せない', async () => {
    await saveBrowserSplitPaymentTracking(owner, request);
    expect(readBrowserSplitPaymentTracking(owner).requests).toEqual([request]);
    expect(readBrowserSplitPaymentTracking(other).requests).toEqual([]);
    expect(data.size).toBe(1);
  });

  it('再コピーで同じ請求を増やさず、受取チェックを消さない', async () => {
    await saveBrowserSplitPaymentTracking(owner, request);
    await updateBrowserSplitPaymentReceived(owner, request.id, 0, 1);
    const saved = await saveBrowserSplitPaymentTracking(owner, { ...request, id: other });
    expect(saved.id).toBe(request.id);
    expect(saved.receivedCount).toBe(1);
    expect(readBrowserSplitPaymentTracking(owner).requests).toHaveLength(1);
  });

  it('全員受取・取り消し・一部受取を記録する', async () => {
    await saveBrowserSplitPaymentTracking(owner, request);
    expect((await updateBrowserSplitPaymentReceived(owner, request.id, 0, 2)).receivedCount).toBe(
      2,
    );
    expect((await updateBrowserSplitPaymentReceived(owner, request.id, 1, 0)).receivedCount).toBe(
      0,
    );
    expect((await updateBrowserSplitPaymentReceived(owner, request.id, 2, 1)).receivedCount).toBe(
      1,
    );
    expect(readBrowserSplitPaymentTracking(owner).requests[0]?.version).toBe(3);
  });

  it('古い画面から更新・削除しても新しいチェックを上書きしない', async () => {
    await saveBrowserSplitPaymentTracking(owner, request);
    await updateBrowserSplitPaymentReceived(owner, request.id, 0, 1);
    await expect(updateBrowserSplitPaymentReceived(owner, request.id, 0, 0)).rejects.toThrow(
      '変わりました',
    );
    await expect(deleteBrowserSplitPaymentTracking(owner, request.id, 0)).rejects.toThrow(
      '変わりました',
    );
    expect(readBrowserSplitPaymentTracking(owner).requests[0]?.receivedCount).toBe(1);
  });

  it('他人の保存先では更新・削除できない', async () => {
    await saveBrowserSplitPaymentTracking(owner, request);
    await expect(updateBrowserSplitPaymentReceived(other, request.id, 0, 1)).rejects.toThrow();
    await expect(deleteBrowserSplitPaymentTracking(other, request.id, 0)).rejects.toThrow();
    expect(readBrowserSplitPaymentTracking(owner).requests).toHaveLength(1);
  });

  it('受取人数が範囲外なら保存しない', async () => {
    await saveBrowserSplitPaymentTracking(owner, request);
    await expect(updateBrowserSplitPaymentReceived(owner, request.id, 0, 3)).rejects.toThrow();
    await expect(updateBrowserSplitPaymentReceived(owner, request.id, 0, -1)).rejects.toThrow();
    expect(readBrowserSplitPaymentTracking(owner).requests[0]?.receivedCount).toBe(0);
  });

  it('壊れた保存内容は上書きせず、読み込み失敗を伝える', async () => {
    data.set(`split-payment-tracking:v1:${owner}`, '{broken');
    expect(readBrowserSplitPaymentTracking(owner).error).not.toBeNull();
    await expect(saveBrowserSplitPaymentTracking(owner, request)).rejects.toThrow();
    expect(data.get(`split-payment-tracking:v1:${owner}`)).toBe('{broken');
  });

  it('容量不足・保存禁止を成功扱いにしない', async () => {
    local.setItem.mockImplementationOnce(() => {
      throw new Error('quota');
    });
    await expect(saveBrowserSplitPaymentTracking(owner, request)).rejects.toThrow(
      '保存できませんでした',
    );
    expect(readBrowserSplitPaymentTracking(owner).requests).toEqual([]);
    local.getItem.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    expect(readBrowserSplitPaymentTracking(owner).error).not.toBeNull();
  });

  it('DBへ取り込んだ元のversionだけを消す', async () => {
    await saveBrowserSplitPaymentTracking(owner, request);
    await updateBrowserSplitPaymentReceived(owner, request.id, 0, 1);
    await removeImportedBrowserSplitPayments(owner, [request]);
    expect(readBrowserSplitPaymentTracking(owner).requests).toHaveLength(1);
    await removeImportedBrowserSplitPayments(owner, [{ ...request, version: 1, receivedCount: 1 }]);
    expect(readBrowserSplitPaymentTracking(owner).requests).toEqual([]);
  });
});
