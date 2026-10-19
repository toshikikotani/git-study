'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FiArrowLeft, FiCamera, FiCheck, FiEdit2, FiImage, FiSettings } from 'react-icons/fi';
import {
  readReceiptQuickAction,
  RECEIPT_QUICK_ACTION_KEY,
  RECEIPT_QUICK_ACTION_EVENT,
  type ReceiptQuickAction,
} from '@/lib/receipt-quick-action';
import styles from './receipt-entry-menu.module.css';

type ReceiptEntryMenuProps = {
  open: boolean;
  onClose: () => void;
  onManual: () => void;
};

function findMenuTrigger() {
  return (
    document.querySelector<HTMLButtonElement>('button[aria-controls="receipt-entry-menu"]') ??
    document.querySelector<HTMLButtonElement>('button[aria-label="記録する"]')
  );
}

function measureMenuAnchor() {
  if (typeof document === 'undefined') return undefined;
  const rect = findMenuTrigger()?.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) return undefined;
  return {
    right: Math.max(16, window.innerWidth - rect.right),
    bottom: window.innerHeight - rect.top + 16,
  };
}

export function ReceiptEntryMenu({ open, ...props }: ReceiptEntryMenuProps) {
  return open ? <ReceiptEntryPopover {...props} /> : null;
}

function ReceiptEntryPopover({ onClose, onManual }: Omit<ReceiptEntryMenuProps, 'open'>) {
  const [settings, setSettings] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [anchor, setAnchor] = useState(measureMenuAnchor);
  const panelRef = useRef<HTMLDivElement>(null);
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
  const preferredLabel = preference === 'manual' ? '手で記録する' : 'レシートを撮る';

  useEffect(() => {
    const panel = panelRef.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : document.querySelector<HTMLButtonElement>('button[aria-label="記録する"]');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      // 手入力などが別のシートを開いた場合、その画面のフォーカスを奪わない。
      if (document.activeElement === document.body || panel?.contains(document.activeElement)) {
        previousFocus?.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus({ preventScroll: true });
  }, [settings]);

  useEffect(() => {
    const updateAnchor = () => {
      const next = measureMenuAnchor();
      setAnchor((previous) =>
        previous?.right === next?.right && previous?.bottom === next?.bottom ? previous : next,
      );
    };
    const trigger = findMenuTrigger();
    // 幅が変わる間も＋に追従する。コンパクト表示ではナビ全体が中央で縮む。
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateAnchor);
    if (trigger) observer?.observe(trigger.closest('.tabbar') ?? trigger);
    const frame = window.requestAnimationFrame(updateAnchor);
    window.addEventListener('resize', updateAnchor);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', updateAnchor);
    };
  }, []);

  return (
    <>
      <button
        type="button"
        className={styles.dismiss}
        aria-label="記録メニューを閉じる"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        id="receipt-entry-menu"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={settings ? '長押しの設定' : '記録する'}
        className={styles.panel}
        style={anchor}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
          if (event.key !== 'Tab') return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
          );
          const first = controls[0];
          const last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        {settings ? (
          <>
            <button type="button" className={styles.back} onClick={() => setSettings(false)}>
              <FiArrowLeft aria-hidden="true" />
              長押しの設定
            </button>
            <p className={styles.description}>＋を長押ししたときに開く画面</p>
            <div role="radiogroup" aria-label="長押しで開く画面">
              {(
                [
                  { value: 'camera', label: 'レシートを撮る', Icon: FiCamera },
                  { value: 'manual', label: '手で記録する', Icon: FiEdit2 },
                ] as const
              ).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={preference === value}
                  className={styles.row}
                  onClick={() => {
                    try {
                      localStorage.setItem(RECEIPT_QUICK_ACTION_KEY, value);
                      window.dispatchEvent(new Event(RECEIPT_QUICK_ACTION_EVENT));
                      setSaveError('');
                    } catch {
                      setSaveError(
                        '設定を保存できませんでした。ブラウザのストレージ設定を確認してください。',
                      );
                    }
                  }}
                >
                  <Icon className={styles.optionIcon} aria-hidden="true" />
                  <span className={styles.label}>{label}</span>
                  {preference === value ? <FiCheck aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
            {saveError ? (
              <p role="alert" className={styles.error}>
                {saveError}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <Link href="/camera" onClick={onClose} className={styles.row}>
              <span className={styles.label}>レシートを撮る</span>
              {preference === 'camera' ? <span className={styles.badge}>長押し</span> : null}
              <FiCamera aria-hidden="true" />
            </Link>
            <Link href="/photos" onClick={onClose} className={styles.row}>
              <span className={styles.label}>写真から読み取る</span>
              <FiImage aria-hidden="true" />
            </Link>
            <button
              type="button"
              onClick={() => {
                onClose();
                onManual();
              }}
              className={styles.row}
            >
              <span className={styles.label}>手で記録する</span>
              {preference === 'manual' ? <span className={styles.badge}>長押し</span> : null}
              <FiEdit2 aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setSettings(true)}
              className={`${styles.row} ${styles.settingsRow}`}
            >
              <span className={styles.label}>
                長押しの設定
                <span className={styles.preference}>長押し: {preferredLabel}</span>
              </span>
              <FiSettings aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </>
  );
}
