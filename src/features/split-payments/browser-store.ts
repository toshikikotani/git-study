'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { parseTrackedSplitPayment, type TrackedSplitPayment } from './types';

const PREFIX = 'split-payment-tracking:v1:';
const CHANGED = 'split-payment-tracking-changed';
const MAX_LENGTH = 2_000_000;
type Snapshot = { requests: TrackedSplitPayment[]; error: string | null };
const EMPTY: Snapshot = { requests: [], error: null };
const UNREADABLE: Snapshot = {
  requests: [],
  error: 'このブラウザの受取待ちを読み込めませんでした。保存を許可してから再読み込みしてください。',
};
const cache = new Map<string, { raw: string | null; snapshot: Snapshot }>();

function key(userId: string): string {
  if (!userId) throw new Error('ログイン状態を確認してください。');
  return `${PREFIX}${userId}`;
}

/** 読み取れない記録を空で上書きしない。別の利用者の保存先は参照しない。 */
export function readBrowserSplitPaymentTracking(userId: string): Snapshot {
  const storageKey = key(userId);
  try {
    const raw = window.localStorage.getItem(storageKey);
    const previous = cache.get(storageKey);
    if (previous?.raw === raw) return previous.snapshot;
    let snapshot = EMPTY;
    if (raw !== null) {
      if (raw.length > MAX_LENGTH) throw new Error('記録の容量が大きすぎます。');
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value)) throw new Error('受取待ちの形式を確認できません。');
      const requests = value.map(parseTrackedSplitPayment);
      if (new Set(requests.map((r) => r.signature)).size !== requests.length) {
        throw new Error('受取待ちの記録が重複しています。');
      }
      snapshot = { requests, error: null };
    }
    cache.set(storageKey, { raw, snapshot });
    return snapshot;
  } catch {
    return UNREADABLE;
  }
}

function current(userId: string): TrackedSplitPayment[] {
  const result = readBrowserSplitPaymentTracking(userId);
  if (result.error) throw new Error(result.error);
  return result.requests;
}

function write(userId: string, requests: readonly TrackedSplitPayment[]): void {
  const value = JSON.stringify(requests);
  if (value.length > MAX_LENGTH) {
    throw new Error('このブラウザの保存容量がいっぱいです。受取済みの請求を整理してください。');
  }
  try {
    window.localStorage.setItem(key(userId), value);
  } catch {
    throw new Error(
      '受取待ちを保存できませんでした。ブラウザの保存設定や空き容量を確認してください。',
    );
  }
  cache.delete(key(userId));
  window.dispatchEvent(new Event(CHANGED));
}

/** 対応ブラウザでは、別タブの読み取りと書き込みも本人ごとに直列化する。 */
async function mutate<T>(userId: string, operation: () => T): Promise<T> {
  const lockName = key(userId);
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(lockName, operation);
  }
  return operation();
}

/** 再コピーしても受取済み人数を戻さず、同じ依頼を増やさない。 */
export async function saveBrowserSplitPaymentTracking(
  userId: string,
  request: TrackedSplitPayment,
): Promise<TrackedSplitPayment> {
  return mutate(userId, () => {
    const validated = parseTrackedSplitPayment(request);
    const requests = current(userId);
    const existing = requests.find((r) => r.signature === validated.signature);
    if (existing) return existing;
    write(userId, [validated, ...requests]);
    return validated;
  });
}

export async function updateBrowserSplitPaymentReceived(
  userId: string,
  id: string,
  expectedVersion: number,
  receivedCount: number,
): Promise<TrackedSplitPayment> {
  return mutate(userId, () => {
    const requests = current(userId);
    const request = requests.find((r) => r.id === id);
    if (!request || request.version !== expectedVersion) {
      throw new Error('受取状況が変わりました。最新の内容を確認してからもう一度操作してください。');
    }
    const updated = parseTrackedSplitPayment({
      ...request,
      receivedCount,
      version: request.version + 1,
    });
    write(
      userId,
      requests.map((r) => (r.id === id ? updated : r)),
    );
    return updated;
  });
}

export async function deleteBrowserSplitPaymentTracking(
  userId: string,
  id: string,
  expectedVersion: number,
): Promise<void> {
  return mutate(userId, () => {
    const requests = current(userId);
    const request = requests.find((r) => r.id === id);
    if (!request || request.version !== expectedVersion) {
      throw new Error('受取状況が変わりました。最新の内容を確認してください。');
    }
    write(
      userId,
      requests.filter((r) => r.id !== id),
    );
  });
}

/** 取り込み開始後に別タブで更新された記録は残す。 */
export async function removeImportedBrowserSplitPayments(
  userId: string,
  originals: readonly TrackedSplitPayment[],
): Promise<void> {
  return mutate(userId, () => {
    const requests = current(userId);
    const remaining = requests.filter(
      (r) =>
        !originals.some(
          (o) =>
            o.signature === r.signature &&
            o.version === r.version &&
            o.receivedCount === r.receivedCount,
        ),
    );
    if (remaining.length !== requests.length) write(userId, remaining);
  });
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(PREFIX)) listener();
  };
  window.addEventListener(CHANGED, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGED, listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useBrowserSplitPaymentTracking(userId: string | null): Snapshot {
  const getSnapshot = useCallback(
    () => (userId ? readBrowserSplitPaymentTracking(userId) : EMPTY),
    [userId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
