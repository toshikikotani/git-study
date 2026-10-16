'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { CategorySheetProvider } from './category-sheet';
import {
  OpenRecordProvider,
  prefetchRecordData,
  RecordSheet,
  type RecordOptions,
} from './record-sheet';
import { parseDateOnlyOr, todayJst } from '@/lib/date';
import { createLongPress } from '@/lib/long-press';
import { UndoToastHost } from '@/components/ui/undo-toast';
import { Fab } from '@/components/ui/fab';
import { AnalysisIcon, ListIcon, PlusIcon, TodayIcon } from '@/components/ui/nav-icons';
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

// デザイン仕様書のボトムナビ(ADR-090):今日・明細・分析と、右に記録する(＋)。分析は「目標」から開く(ADR-091)。
// 見通しと目標は「今日」から開く。アイコンの下に名前(色だけで選択中を示さない)。
const NAV = [
  { href: '/', label: '今日', Icon: TodayIcon },
  { href: '/spending', label: '明細', Icon: ListIcon },
  { href: '/reports', label: '分析', Icon: AnalysisIcon },
] as const;

/** 記録メニューの大きなタイル(カメラ・写真から・手入力)の色。 */

/** 記録するのシートの開き方と、開いた回の番号。 */
type OpenRecord = RecordOptions & { openId: number };
let openSeq = 0;
function nextOpenId(): number {
  openSeq += 1;
  return openSeq;
}

function isSameTab(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  // 今期の目標(/plan/edit)は「分析 › 目標」から開く画面なので、分析のタブを選択中にする(ADR-091)。
  if (href === '/reports' && (pathname === '/plan' || pathname.startsWith('/plan/'))) return true;
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

  // 記録する(＋)のシート。開いているときは初期値(日付・支出か収入か)、閉じているときは null。
  // ＋のほか、明細のカレンダーの「この日に手で記録」や、ホーム画面のショートカット
  // (?record=1、旧 /transactions/new からも転送)から開く(ADR-096)。
  // 開くたびに番号を振り、シートの中身を作り直す(閉じかけのシートをそのまま開き直さない。
  // 保存できずにすぐ開き直したとき、前の中身のまま「保存」が効かなくなっていた)。
  const [record, setRecord] = useState<OpenRecord | null>(null);
  const openRecord = useCallback(
    (options?: RecordOptions) => setRecord({ ...options, openId: nextOpenId() }),
    [],
  );
  const closeRecord = useCallback(() => setRecord(null), []);
  // 記録するのカテゴリと口座を先に読んでおく(開いた瞬間からタイルが並ぶように、ADR-098)。
  // 画面の読み込みを邪魔しないよう、少し待ってから。
  useEffect(() => {
    const timer = window.setTimeout(() => void prefetchRecordData(), 1500);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('record') !== '1') return;
    const type = url.searchParams.get('type');
    const date = url.searchParams.get('date');
    for (const key of ['record', 'type', 'date']) url.searchParams.delete(key);
    window.history.replaceState(null, '', url.pathname + url.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URLからの一度きりの起動
    setRecord({
      openId: nextOpenId(),
      date: parseDateOnlyOr(date, todayJst()),
      kind: type === 'income' ? 'income' : 'expense',
    });
  }, [pathname]);

  return (
    <CategorySheetProvider>
      <OpenRecordProvider value={openRecord}>
        <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
          <div aria-hidden className="status-blur" />
          <PullToRefresh>
            <main
              className="flex-1 px-4 pt-[max(5.5rem,calc(3.5rem+env(safe-area-inset-top)))] pb-[calc(11rem+env(safe-area-inset-bottom))]"
              aria-busy={navigating}
            >
              {children}
            </main>
          </PullToRefresh>
          <UndoToastHost />
          {isClient ? (
            createPortal(
              <BottomBar
                onNavigate={beginNavigate}
                record={record}
                onOpenRecord={openRecord}
                onCloseRecord={closeRecord}
              />,
              document.body,
            )
          ) : (
            <BottomBar
              onNavigate={beginNavigate}
              record={record}
              onOpenRecord={openRecord}
              onCloseRecord={closeRecord}
            />
          )}
        </div>
      </OpenRecordProvider>
    </CategorySheetProvider>
  );
}

function BottomBar({
  onNavigate,
  record,
  onOpenRecord,
  onCloseRecord,
}: {
  onNavigate: (href: string) => void;
  record: OpenRecord | null;
  onOpenRecord: (options?: RecordOptions) => void;
  onCloseRecord: () => void;
}) {
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
  const setFabMenuOpen = useCallback(
    (open: boolean) => (open ? onOpenRecord() : onCloseRecord()),
    [onOpenRecord, onCloseRecord],
  );
  const longPress = useMemo(
    () => createLongPress({ onLongPress: () => setFabMenuOpen(true) }),
    [setFabMenuOpen],
  );
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
  // 右の＋は、押すと「記録する」のシートを開く(デザイン仕様書、ADR-090:撮る・写真から・手で入力)。
  // すぐにカメラを開かない(誤って撮らないため、本人の希望)。長押しでも同じシート。
  const fab = (
    <Fab label="記録する" size="large" onPress={() => setFabMenuOpen(true)}>
      <PlusIcon />
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
      <BottomSheet
        open={record !== null}
        onClose={() => setFabMenuOpen(false)}
        role="dialog"
        label="記録する"
        tall
      >
        <RecordSheet
          key={record?.openId ?? 0}
          onClose={() => setFabMenuOpen(false)}
          onCamera={(mode) => {
            setFabMenuOpen(false);
            setCameraMode(mode);
            setCameraOpen(true);
          }}
          onFiles={(files) => {
            enqueueReceiptFiles(files);
            setFabMenuOpen(false);
          }}
          canStream={canStream}
          initialDate={record?.date}
          initialKind={record?.kind}
          initialError={record?.error}
        />
      </BottomSheet>
      <div className="tabbar flex w-full items-center gap-3" data-compact={compact}>
        <nav aria-label="メイン" className="min-w-0 flex-1">
          <ul className="tabbar-pill liquid-capsule flex items-center">
            {NAV.map((item) => {
              const isActive = isSameTab(pathname, item.href);
              return (
                <li key={item.href} className="flex-1">
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
                    className="flex min-h-11 flex-col items-center"
                  >
                    <span
                      className={`liquid-tab text-[11px] font-semibold whitespace-nowrap${isActive ? ' is-active' : ''}`}
                      style={{ flexDirection: 'column', gap: 2 }}
                    >
                      <item.Icon />
                      {item.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div
          className="shrink-0"
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
      </div>
    </div>
  );
}
