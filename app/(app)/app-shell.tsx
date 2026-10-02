'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { MdCameraAlt } from 'react-icons/md';

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
import { scrollToTop, tabTapAction } from '@/lib/scroll';
import { createCaptureFromReadAction } from './transactions/receipt/capture-actions';
import './liquid-tab.css';

configureReceiptQueue({ createCapture: createCaptureFromReadAction });

const NAV = [
  { href: '/', label: 'ホーム' },
  { href: '/spending', label: '家計簿' },
  { href: '/plan', label: '目標' },
  { href: '/payday', label: '給料日' },
] as const;

function isSameTab(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
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
        createPortal(
          <BottomBar pendingHref={navigating ? pendingHref : null} onNavigate={beginNavigate} />,
          document.body,
        )
      ) : (
        <BottomBar pendingHref={null} onNavigate={beginNavigate} />
      )}
    </div>
  );
}

function BottomBar({
  pendingHref,
  onNavigate,
}: {
  pendingHref: string | null;
  onNavigate: (href: string) => void;
}) {
  const pathname = usePathname();
  const isClient = useIsClient();
  const jobs = useReceiptJobs();
  useEffect(() => {
    void restoreWaitingReceipts();
  }, []);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        setCompact((prev) => nextChromeCompact(prev, y, last));
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
  const fab = canStream ? (
    <Fab
      label="レシートを撮る"
      onPress={() => {
        setCameraMode('single');
        setCameraOpen(true);
      }}
    >
      <MdCameraAlt aria-hidden size={26} />
    </Fab>
  ) : (
    <Fab label="レシートを撮る" onFiles={(files) => enqueueReceiptFiles(files)}>
      <MdCameraAlt aria-hidden size={26} />
    </Fab>
  );
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
      <BottomSheet open={fabMenuOpen} onClose={() => setFabMenuOpen(false)} role="menu">
        <ul className="px-2 pb-2">
          <li>
            <Link
              href="/transactions/new"
              prefetch={false}
              role="menuitem"
              onPointerDown={() => onNavigate('/transactions/new')}
              onClick={() => setFabMenuOpen(false)}
              className="flex min-h-11 items-center px-2 text-base font-semibold"
              style={{ color: 'var(--ink)' }}
            >
              手入力
            </Link>
          </li>
          <li>
            <label
              role="menuitem"
              className="flex min-h-11 cursor-pointer items-center px-2 text-base font-semibold"
              style={{ color: 'var(--ink)' }}
            >
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
          </li>
          {canStream ? (
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setFabMenuOpen(false);
                  setCameraMode('continuous');
                  setCameraOpen(true);
                }}
                className="flex min-h-11 w-full items-center px-2 text-left text-base font-semibold"
                style={{ color: 'var(--ink)' }}
              >
                連続撮影
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
              className="flex min-h-11 items-center px-2 text-base font-semibold"
              style={{ color: 'var(--ink)' }}
            >
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
              className="flex min-h-11 items-center px-2 text-base font-semibold"
              style={{ color: 'var(--ink)' }}
            >
              スクショから記録
            </Link>
          </li>
        </ul>
      </BottomSheet>
      <div className="tabbar flex w-full items-center" data-compact={compact}>
        <nav className="min-w-0 flex-1">
          <ul className="tabbar-pill liquid-capsule flex items-center gap-1">
            {NAV.map((item, index) => {
              const shown = pendingHref ?? pathname;
              const isActive = isSameTab(shown, item.href);
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
                      onPointerDown={() => {
                        if (tabTapAction(pathname, item.href) === 'navigate') onNavigate(item.href);
                      }}
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
                      >
                        {item.label}
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
