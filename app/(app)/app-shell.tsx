'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MdBurstMode,
  MdCameraAlt,
  MdEdit,
  MdHome,
  MdMenuBook,
  MdMic,
  MdPayments,
  MdPhotoLibrary,
  MdReceiptLong,
  MdScreenshot,
  MdTrackChanges,
} from 'react-icons/md';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { createLongPress } from '@/lib/long-press';
import { UndoToastHost } from '@/components/ui/undo-toast';
import { Fab } from '@/components/ui/fab';
import { MoreMenu } from '@/components/ui/more-menu';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { useIsClient } from '@/components/ui/use-is-client';
import { ReceiptCamera } from '@/components/receipt/receipt-camera';
import {
  configureReceiptQueue,
  countReading,
  enqueueReceiptFiles,
  restoreWaitingReceipts,
  useReceiptJobs,
} from '@/features/import/receipt-queue';
import { nextChromeCompact } from '@/lib/chrome';
import { upgradeStoredTheme } from '@/lib/color-theme';
import { scrollToTop, tabTapAction } from '@/lib/scroll';
import { createCaptureFromReadAction } from './transactions/receipt/capture-actions';
import './liquid-tab.css';

configureReceiptQueue({ createCapture: createCaptureFromReadAction });

// デザインのボトムナビ:アイコンの下に名前(色だけで選択中を示さない)。
const NAV = [
  { href: '/', label: 'ホーム', Icon: MdHome },
  { href: '/spending', label: '家計簿', Icon: MdMenuBook },
  { href: '/plan', label: '目標', Icon: MdTrackChanges },
  { href: '/payday', label: '給料日', Icon: MdPayments },
] as const;

/** 記録メニューの大きなタイル(カメラ・写真から・手入力)の色。 */
const MENU_TILE_STYLE: React.CSSProperties = {
  background: 'var(--accent-track)',
  color: 'var(--ink)',
};

function isSameTab(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // 以前に選んだ色(4色だけの保存)を、今の色の役割に置き換える(ADR-079)。
  useEffect(() => {
    upgradeStoredTheme();
  }, []);
  const isClient = useIsClient();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const navigating = pendingHref !== null && !isSameTab(pathname, pendingHref);

  if (pendingHref !== null && isSameTab(pathname, pendingHref)) setPendingHref(null);

  function beginNavigate(href: string) {
    if (isSameTab(pathname, href) || pendingHref === href) return;
    setPendingHref(href);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <div aria-hidden className="status-blur" />
      <PullToRefresh>
        <main
          className="flex-1 px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(11rem+env(safe-area-inset-bottom))]"
          aria-busy={navigating}
        >
          {children}
        </main>
      </PullToRefresh>
      <UndoToastHost />
      {isClient ? (
        createPortal(<BottomBar onNavigate={beginNavigate} />, document.body)
      ) : (
        <BottomBar onNavigate={beginNavigate} />
      )}
    </div>
  );
}

function BottomBar({ onNavigate }: { onNavigate: (href: string) => void }) {
  const pathname = usePathname();
  const isClient = useIsClient();
  const jobs = useReceiptJobs();
  useEffect(() => {
    void restoreWaitingReceipts();
  }, []);
  const [compact, setCompact] = useState(false);
  const [compactPath, setCompactPath] = useState(pathname);
  if (compactPath !== pathname) {
    // 画面が変わったら縮んだメニューを戻す。effect 内の setState は lint が拒否する。
    setCompactPath(pathname);
    setCompact(false);
  }
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        setCompact((prev) => (y <= 0 ? false : nextChromeCompact(prev, y, last)));
        if (Math.abs(y - last) > 8 || y <= 0) last = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<'single' | 'continuous'>('single');
  const [fabMenuOpen, setFabMenuOpen] = useState(false);
  const longPress = useMemo(() => createLongPress({ onLongPress: () => setFabMenuOpen(true) }), []);
  const reading = countReading(jobs);
  const waiting = jobs.filter((j) => j.status === 'ready' || j.status === 'error').length;
  const offlineWaiting = jobs.filter((j) => j.status === 'waiting').length;
  const needInput = jobs.filter((j) => j.status === 'needs_input').length;
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('capture') !== '1') return;
    url.searchParams.delete('capture');
    window.history.replaceState(null, '', url.pathname + url.search);
    if (typeof navigator.mediaDevices?.getUserMedia === 'function') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- URLからの一度きりの起動
      setCameraOpen(true);
    }
  }, []);
  const canStream = isClient && Boolean(navigator.mediaDevices?.getUserMedia);
  // 中央のボタンは、押すと記録のしかたを選ぶメニューを開く(カメラ・写真から・手入力)。
  // すぐにカメラを開かない(誤って撮らないため、本人の希望)。長押しでも同じメニュー。
  const fab = (
    <Fab label="記録する(カメラ・写真・手入力)" onPress={() => setFabMenuOpen(true)}>
      <MdReceiptLong aria-hidden size={26} />
    </Fab>
  );
  const closeMenuAnd = (fn: () => void) => () => {
    setFabMenuOpen(false);
    fn();
  };
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {reading + waiting + offlineWaiting + needInput > 0 ? (
        <Link
          href="/transactions/receipt"
          prefetch={false}
          role="status"
          onPointerDown={() => onNavigate('/transactions/receipt')}
          className="min-h-11 inline-flex items-center label-text px-4 py-2 text-xs"
          style={{
            borderRadius: 'var(--radius-full)',
            background: 'var(--glass-tint-strong)',
            backdropFilter: 'var(--glass-blur)',
            border: '1px solid var(--glass-border)',
            color: 'var(--ink)',
          }}
        >
          {[
            reading > 0 ? `読み取り中 ${reading}件` : '',
            offlineWaiting > 0 ? `読み取り待ち ${offlineWaiting}件` : '',
            waiting > 0 ? `確認待ち ${waiting}件` : '',
            needInput > 0 ? `入力待ち ${needInput}件` : '',
          ]
            .filter((t) => t !== '')
            .join(' ・ ')}
          <span aria-hidden> →</span>
        </Link>
      ) : null}
      {cameraOpen ? (
        <ReceiptCamera
          initialMode={cameraMode}
          onCapture={(files) => enqueueReceiptFiles(files)}
          onClose={() => setCameraOpen(false)}
        />
      ) : null}
      <BottomSheet
        open={fabMenuOpen}
        onClose={() => setFabMenuOpen(false)}
        role="menu"
        label="記録する"
      >
        <div className="space-y-3 px-3 pb-3">
          <h2 className="px-1 text-base font-semibold" style={{ color: 'var(--ink)' }}>
            記録する
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {canStream ? (
              <button
                type="button"
                role="menuitem"
                onClick={closeMenuAnd(() => {
                  setCameraMode('single');
                  setCameraOpen(true);
                })}
                className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl px-2 text-center text-sm font-semibold"
                style={MENU_TILE_STYLE}
              >
                <MdCameraAlt aria-hidden size={28} />
                カメラで撮る
              </button>
            ) : (
              <label
                role="menuitem"
                className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl px-2 text-center text-sm font-semibold"
                style={MENU_TILE_STYLE}
              >
                <MdCameraAlt aria-hidden size={28} />
                カメラで撮る
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={(e) => {
                    enqueueReceiptFiles(Array.from(e.target.files ?? []));
                    e.target.value = '';
                    setFabMenuOpen(false);
                  }}
                />
              </label>
            )}
            <label
              role="menuitem"
              className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl px-2 text-center text-sm font-semibold"
              style={MENU_TILE_STYLE}
            >
              <MdPhotoLibrary aria-hidden size={28} />
              写真から選ぶ
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  enqueueReceiptFiles(Array.from(e.target.files ?? []));
                  e.target.value = '';
                  setFabMenuOpen(false);
                }}
              />
            </label>
            <Link
              href="/transactions/new"
              prefetch={false}
              role="menuitem"
              onPointerDown={() => onNavigate('/transactions/new')}
              onClick={() => setFabMenuOpen(false)}
              className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl px-2 text-center text-sm font-semibold"
              style={MENU_TILE_STYLE}
            >
              <MdEdit aria-hidden size={28} />
              手入力
            </Link>
          </div>
          <ul className="overflow-hidden rounded-2xl" style={{ background: 'var(--plane)' }}>
            {canStream ? (
              <li>
                <button
                  type="button"
                  role="menuitem"
                  onClick={closeMenuAnd(() => {
                    setCameraMode('continuous');
                    setCameraOpen(true);
                  })}
                  className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm font-semibold"
                  style={{ color: 'var(--ink)' }}
                >
                  <MdBurstMode aria-hidden size={20} />
                  何枚か続けて撮る
                </button>
              </li>
            ) : null}
            <li>
              <Link
                href="/transactions/capture-text"
                prefetch={false}
                role="menuitem"
                onPointerDown={() => onNavigate('/transactions/capture-text')}
                onClick={() => setFabMenuOpen(false)}
                className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm font-semibold"
                style={{ color: 'var(--ink)' }}
              >
                <MdMic aria-hidden size={20} />
                話して記録・文字で記録
              </Link>
            </li>
            <li>
              <Link
                href="/transactions/capture-screenshot"
                prefetch={false}
                role="menuitem"
                onPointerDown={() => onNavigate('/transactions/capture-screenshot')}
                onClick={() => setFabMenuOpen(false)}
                className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm font-semibold"
                style={{ color: 'var(--ink)' }}
              >
                <MdScreenshot aria-hidden size={20} />
                スクショから記録
              </Link>
            </li>
          </ul>
        </div>
      </BottomSheet>
      <div className="tabbar flex w-full items-center" data-compact={compact}>
        <nav className="min-w-0 flex-1">
          <ul className="tabbar-pill liquid-capsule flex items-center gap-1">
            {NAV.map((item, index) => {
              const isActive = isSameTab(pathname, item.href);
              return (
                <Fragment key={item.href}>
                  {index === 2 ? (
                    <li
                      className="flex w-16 shrink-0 justify-center self-center"
                      aria-label="レシートを撮る"
                    >
                      <div
                        style={{ transform: 'translateY(calc(var(--fab-lift) * -1))' }}
                        onPointerDown={(e) => longPress.start(e.clientX, e.clientY)}
                        onPointerMove={(e) => longPress.move(e.clientX, e.clientY)}
                        onPointerUp={longPress.end}
                        onPointerCancel={longPress.end}
                        onContextMenu={(e) => e.preventDefault()}
                        onClickCapture={(e) => {
                          if (longPress.consumeClick()) {
                            e.preventDefault();
                            e.stopPropagation();
                          }
                        }}
                      >
                        {fab}
                      </div>
                    </li>
                  ) : null}
                  <li className="flex-1">
                    <Link
                      href={item.href}
                      prefetch
                      aria-current={isActive ? 'page' : undefined}
                      onClick={(e) => {
                        if (tabTapAction(pathname, item.href) === 'scroll-top') {
                          e.preventDefault();
                          scrollToTop();
                        }
                      }}
                      className="min-h-11 flex flex-col items-center gap-1 py-2"
                    >
                      <span
                        className={`label-text liquid-tab text-xs whitespace-nowrap${isActive ? ' is-active' : ''}`}
                        style={{ flexDirection: 'column', gap: 2 }}
                      >
                        <item.Icon aria-hidden size={20} />
                        <span className={isActive ? 'font-semibold' : undefined}>{item.label}</span>
                      </span>
                    </Link>
                  </li>
                </Fragment>
              );
            })}
            <li className="flex shrink-0 items-center justify-center self-center">
              <MoreMenu onNavigate={onNavigate} />
            </li>
          </ul>
        </nav>
      </div>
    </div>
  );
}
