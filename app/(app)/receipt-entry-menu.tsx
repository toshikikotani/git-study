'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import {
  readReceiptQuickAction,
  RECEIPT_QUICK_ACTION_KEY,
  RECEIPT_QUICK_ACTION_EVENT,
  type ReceiptQuickAction,
} from '@/lib/receipt-quick-action';

export function ReceiptEntryMenu({
  open,
  onClose,
  onManual,
}: {
  open: boolean;
  onClose: () => void;
  onManual: () => void;
}) {
  const [settings, setSettings] = useState(false);
  const preference = useSyncExternalStore(
    (listener) => {
      window.addEventListener('storage', listener);
      window.addEventListener(RECEIPT_QUICK_ACTION_EVENT, listener);
      return () => {
        window.removeEventListener('storage', listener);
        window.removeEventListener(RECEIPT_QUICK_ACTION_EVENT, listener);
      };
    },
    readReceiptQuickAction,
    (): ReceiptQuickAction => 'camera',
  );
  const [saveError, setSaveError] = useState('');
  const close = () => {
    setSettings(false);
    onClose();
  };
  const row =
    'flex min-h-12 w-full items-center justify-between gap-3 border-b px-4 py-4 text-left';
  return (
    <BottomSheet open={open} onClose={close} label={settings ? '長押しの設定' : '記録する'}>
      <div className="space-y-3 py-4">
        <h2 className="px-4 text-lg font-semibold">{settings ? '長押しの設定' : '記録する'}</h2>
        {settings ? (
          <>
            <p className="px-4 text-sm">＋を長押ししたときに、すぐ開く画面を選びます。</p>
            <div role="radiogroup" aria-label="長押しで開く画面">
              {(
                [
                  { value: 'camera', label: 'レシートを撮る' },
                  { value: 'manual', label: '手で記録する' },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={preference === option.value}
                  className={row}
                  onClick={() => {
                    try {
                      localStorage.setItem(RECEIPT_QUICK_ACTION_KEY, option.value);
                      window.dispatchEvent(new Event(RECEIPT_QUICK_ACTION_EVENT));
                      setSaveError('');
                    } catch {
                      setSaveError(
                        '設定を保存できませんでした。ブラウザのストレージ設定を確認してください。',
                      );
                    }
                  }}
                >
                  {option.label}
                  <span aria-hidden>{preference === option.value ? '●' : '○'}</span>
                </button>
              ))}
            </div>
            {saveError ? (
              <p role="alert" className="px-4 text-sm">
                {saveError}
              </p>
            ) : null}
            <button type="button" className={row} onClick={() => setSettings(false)}>
              メニューに戻る
            </button>
          </>
        ) : (
          <>
            <Link href="/camera" onClick={close} className={row}>
              レシートを撮る
              {preference === 'camera' ? <span className="text-xs">長押し</span> : null}
              <span aria-hidden>▣</span>
            </Link>
            <Link href="/photos" onClick={close} className={row}>
              写真から読み取る<span aria-hidden>▧</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                close();
                onManual();
              }}
              className={row}
            >
              手で記録する{preference === 'manual' ? <span className="text-xs">長押し</span> : null}
              <span aria-hidden>✎</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSettings(true);
              }}
              className={row}
            >
              長押しの設定<span aria-hidden>⚙</span>
            </button>
          </>
        )}
        <button type="button" onClick={close} className="min-h-11 w-full px-4 py-3">
          閉じる
        </button>
      </div>
    </BottomSheet>
  );
}
