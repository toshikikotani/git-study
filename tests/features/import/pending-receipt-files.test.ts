import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  setPendingReceiptFiles,
  subscribePendingReceiptFiles,
  takePendingReceiptFiles,
} from '@/features/import/pending-receipt-files';

/**
 * ボトムナビのカメラ FAB → /transactions/receipt への橋渡し(本人からの
 * 不具合報告「画像渡して何の反応も無い」への対応、P10-18)。
 *
 * 「マウント時に1度だけ取得」だけでは、ADR-029(staleTimes による Router
 * Cache 再利用)でこの画面がマウントし直されない2回目以降のファイルに
 * 気づけなかった。購読(subscribe)が正しく通知することをここで保証する。
 */

function fakeFile(name: string): File {
  return { name } as unknown as File;
}

// モジュール変数(pendingFiles・listeners)はテスト間で共有されるため、
// 各テストの前に必ず1度取り出して空にしておく(前のテストの置き土産を防ぐ)。
beforeEach(() => {
  takePendingReceiptFiles();
});

describe('setPendingReceiptFiles / takePendingReceiptFiles', () => {
  it('置いたファイルを取り出せる', () => {
    setPendingReceiptFiles([fakeFile('a.jpg')]);
    expect(takePendingReceiptFiles()).toEqual([fakeFile('a.jpg')]);
  });

  it('1度取り出したら消える(直接 URL を開いた場合などは常に null)', () => {
    setPendingReceiptFiles([fakeFile('a.jpg')]);
    takePendingReceiptFiles();
    expect(takePendingReceiptFiles()).toBeNull();
  });

  it('何も置かれていなければ null', () => {
    expect(takePendingReceiptFiles()).toBeNull();
  });
});

describe('subscribePendingReceiptFiles', () => {
  it('setPendingReceiptFiles() のたびに購読者へ通知する', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePendingReceiptFiles(listener);

    setPendingReceiptFiles([fakeFile('a.jpg')]);
    expect(listener).toHaveBeenCalledTimes(1);

    setPendingReceiptFiles([fakeFile('b.jpg')]);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it('画面がマウントされたまま(Router Cache 再利用)でも、購読側が新しいファイルを拾える', () => {
    // takePendingReceiptFiles() を直接呼ぶマウント時の1回きりの取得を
    // 模したうえで、その後に届く分は購読でしか拾えないことを確認する。
    const received: File[][] = [];
    const unsubscribe = subscribePendingReceiptFiles(() => {
      const pending = takePendingReceiptFiles();
      if (pending) received.push(pending);
    });

    setPendingReceiptFiles([fakeFile('first.jpg')]);
    setPendingReceiptFiles([fakeFile('second.jpg')]);

    expect(received).toEqual([[fakeFile('first.jpg')], [fakeFile('second.jpg')]]);
    unsubscribe();
  });

  it('解除(unsubscribe)後は通知されない', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePendingReceiptFiles(listener);
    unsubscribe();

    setPendingReceiptFiles([fakeFile('a.jpg')]);
    expect(listener).not.toHaveBeenCalled();
  });
});
