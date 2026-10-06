/**
 * オフラインで撮ったレシート画像の一時保管(IndexedDB)。
 *
 * 圏外で撮ったレシートを「失敗」にせず「読み取り待ち」にし、ページを閉じても失わないよう
 * 端末に置く。オンラインに戻ったら自動で読み取り、済んだら消す(receipt-queue.ts)。
 * IndexedDB が使えない環境(プライベートモード等)では黙って何もしない——その場合は
 * 画面を開いている間だけ「読み取り待ち」を保つ(メモリのみ)。新規依存は使わない。
 */

const DB_NAME = 'receipt-waiting';
const STORE = 'files';

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export type WaitingFile = { id: string; blob: Blob; createdAt: number };

export async function saveWaitingFile(entry: WaitingFile): Promise<void> {
  const db = await open();
  if (db === null) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

export async function deleteWaitingFile(id: string): Promise<void> {
  const db = await open();
  if (db === null) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

export async function loadWaitingFiles(): Promise<WaitingFile[]> {
  const db = await open();
  if (db === null) return [];
  const items = await new Promise<WaitingFile[]>((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as WaitingFile[]);
    req.onerror = () => resolve([]);
  });
  db.close();
  return items;
}
