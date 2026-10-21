'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  FiCamera,
  FiCheck,
  FiEdit2,
  FiFileText,
  FiImage,
  FiMail,
  FiSettings,
} from 'react-icons/fi';
import {
  readReceiptQuickAction,
  RECEIPT_QUICK_ACTION_KEY,
  RECEIPT_QUICK_ACTION_EVENT,
  type ReceiptQuickAction,
} from '@/lib/receipt-quick-action';
import styles from './receipt-entry-menu.module.css';

/**
 * ＋を押したときのメニュー(デザイン v3-11、ADR-125 → 126 → 127)。記録の入口はここに集める:撮る・
 * 写真から読み取る・手で記録する・メールから取り込む・CSVを取り込む、と長押しの設定。
 * 色はアプリのテーマに合わせる(固定の色を使わない)。
 *   - レシートを撮る:その場でカメラを開く(画面を移らない)
 *   - 写真から読み取る:端末の写真を選ぶ画面をすぐ開く(間に自前の画面を挟まない)
 *   - 長押しの設定:メニューの中で開いて選ぶ(別の画面にしない)
 */
type ReceiptEntryMenuProps = {
  open: boolean;
  onClose: () => void;
  onCamera: () => void;
  onFiles: (files: File[]) => void;
  onManual: () => void;
};

const LONG_PRESS_OPTIONS = [
  { value: 'camera', label: 'カメラ(レシートを撮る)' },
  { value: 'manual', label: '手で記録する' },
] as const;

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

function ReceiptEntryPopover({
  onClose,
  onCamera,
  onFiles,
  onManual,
}: Omit<ReceiptEntryMenuProps, 'open'>) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [anchor, setAnchor] = useState(measureMenuAnchor);
  const panelRef = useRef<HTMLDivElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
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
    panel?.querySelector<HTMLElement>('a[href], button')?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      // 手入力・カメラなどが別の画面を開いた場合、その画面のフォーカスを奪わない。
      if (document.activeElement === document.body || panel?.contains(document.activeElement)) {
        previousFocus?.focus({ preventScroll: true });
      }
    };
  }, []);

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

  const choose = (value: ReceiptQuickAction) => {
    try {
      localStorage.setItem(RECEIPT_QUICK_ACTION_KEY, value);
      window.dispatchEvent(new Event(RECEIPT_QUICK_ACTION_EVENT));
      setSaveError('');
      setSettingsOpen(false);
    } catch {
      setSaveError('設定を保存できませんでした。ブラウザのストレージ設定を確認してください。');
    }
  };

  return (
    <>
      <button
        type="button"
        className={styles.dismiss}
        data-tap-ok
        aria-label="記録メニューを閉じる"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        id="receipt-entry-menu"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="記録する"
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
        <button
          type="button"
          onClick={() => {
            onClose();
            onCamera();
          }}
          className={styles.row}
        >
          <span className={styles.label}>レシートを撮る</span>
          {preference === 'camera' ? <span className={styles.badge}>長押し</span> : null}
          <FiCamera aria-hidden="true" />
        </button>
        {/* 押すと端末の写真を選ぶ画面がすぐ開く。選んだら読み取りへ回してメニューを閉じる
            (選ぶのをやめたらメニューはそのまま)。 */}
        <button type="button" onClick={() => photoInput.current?.click()} className={styles.row}>
          <span className={styles.label}>写真から読み取る</span>
          <FiImage aria-hidden="true" />
        </button>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length === 0) return;
            onClose();
            onFiles(files);
          }}
        />
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
        <Link href="/transactions/email" prefetch={false} onClick={onClose} className={styles.row}>
          <span className={styles.label}>メールから取り込む</span>
          <FiMail aria-hidden="true" />
        </Link>
        <Link href="/transactions/import" prefetch={false} onClick={onClose} className={styles.row}>
          <span className={styles.label}>CSVを取り込む</span>
          <FiFileText aria-hidden="true" />
        </Link>
        <button
          type="button"
          aria-expanded={settingsOpen}
          aria-controls="receipt-entry-long-press"
          onClick={() => setSettingsOpen((value) => !value)}
          className={`${styles.row} ${styles.settingsRow}`}
        >
          <span className={styles.label}>
            長押しの設定
            <span className={styles.preference}>長押し：{preferredLabel}</span>
          </span>
          <FiSettings aria-hidden="true" />
        </button>
        {settingsOpen ? (
          <div
            id="receipt-entry-long-press"
            role="radiogroup"
            aria-label="＋を長押ししたとき"
            className={styles.options}
          >
            <p className={styles.description}>＋を長押ししたとき</p>
            {LONG_PRESS_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={preference === value}
                className={styles.option}
                onClick={() => choose(value)}
              >
                <span className={styles.check} aria-hidden="true">
                  {preference === value ? <FiCheck /> : null}
                </span>
                {label}
              </button>
            ))}
            {saveError ? (
              <p role="alert" className={styles.error}>
                {saveError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
