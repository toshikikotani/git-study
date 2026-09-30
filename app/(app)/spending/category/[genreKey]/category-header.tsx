'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { GenreBadge } from '@/components/ui/genre-badge';
import { RollingNumber } from '@/components/ui/rolling-number';
import { SharedElement, sharedName } from '@/components/ui/shared-element';
import { monthChoices } from '@/features/category/months';
import { addMonths, formatMonthJa } from '@/lib/date';
import { hapticFor } from '@/lib/haptics';
import { classifyHorizontalSwipe, monthHref } from '@/lib/category-nav';

/**
 * カテゴリ詳細のヘッダー。
 *
 * 大きな表示(アイコン・カテゴリ名・期間の切り替え・合計)から始まり、スクロールすると
 * 上部に小さく固定される(アイコン + カテゴリ名 + 合計金額)。行のアイコン・名前・金額は
 * 共有要素として、家計簿の行からここへそのまま移動・拡大する(戻るときは逆)。
 * 期間は家計簿の期間を引き継ぎ、‹ 9月 › か、左右のスワイプで切り替える。
 */
export function CategoryHeader({
  genreKey,
  genreName,
  monthStart,
  isCurrentMonth,
  todayMonthKey,
  totalYen,
  onBack,
  menu,
}: {
  genreKey: string;
  genreName: string;
  monthStart: string;
  isCurrentMonth: boolean;
  /** 今月(期間の選択肢の起点)。 */
  todayMonthKey: string;
  /** 実績の使った額(返品・返金を差し引いた額)。 */
  totalYen: number;
  onBack: () => void;
  /** ヘッダー右の操作(選択・…)。 */
  menu?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const sentinel = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const monthKey = monthStart.slice(0, 7);
  const monthLabel = `${monthStart.slice(0, 4)}年${formatMonthJa(monthKey)}`;
  const prev = addMonths(monthStart, -1).slice(0, 7);
  const next = addMonths(monthStart, 1).slice(0, 7);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setCompact(!entry!.isIntersecting), {
      rootMargin: '-56px 0px 0px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const go = (target: string) => {
    hapticFor('tabChange');
    startTransition(() => router.replace(monthHref(genreKey, target) as Route, { scroll: false }));
  };

  return (
    <>
      {/* スクロールしたら上部に小さく固定される(アイコン + カテゴリ名 + 合計金額) */}
      <div
        aria-hidden={!compact}
        className="fixed inset-x-0 top-0 z-30 transition-opacity"
        style={{
          opacity: compact ? 1 : 0,
          pointerEvents: compact ? 'auto' : 'none',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          background: 'var(--glass-tint-strong)',
          backdropFilter: 'var(--glass-blur)',
          WebkitBackdropFilter: 'var(--glass-blur)',
          transitionDuration: 'var(--motion-small)',
        }}
      >
        <div className="mx-auto flex min-h-11 w-full max-w-2xl items-center gap-3 px-4">
          <GenreBadge name={genreKey === 'none' ? null : genreName} size={24} />
          <span className="min-w-0 flex-1 truncate text-base font-semibold">{genreName}</span>
          <RollingNumber value={totalYen} className="text-base font-semibold" />
        </div>
      </div>

      <header
        className="touch-pan-y"
        onPointerDown={(e) => {
          swipe.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s) return;
          const dir = classifyHorizontalSwipe(e.clientX - s.x, e.clientY - s.y);
          // 右へ払う = 前の月、左へ払う = 次の月
          if (dir === 'right') go(prev);
          else if (dir === 'left' && !isCurrentMonth) go(next);
        }}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="min-h-11 inline-flex items-center pr-3 text-sm font-semibold"
            style={{ color: 'var(--ink-secondary)' }}
          >
            ‹ 家計簿
          </button>
          {menu}
        </div>

        <div ref={sentinel} className="mt-2 flex items-center gap-3">
          <SharedElement name={sharedName.icon(genreKey)}>
            <GenreBadge name={genreKey === 'none' ? null : genreName} size={56} />
          </SharedElement>
          <h1 className="min-w-0 flex-1 text-3xl leading-tight font-semibold break-words">
            <SharedElement name={sharedName.title(genreKey)}>
              <span className="block">{genreName}</span>
            </SharedElement>
          </h1>
        </div>

        {/* 合計金額が主役。期間の切り替えとは横に並べず、金額を左揃えで大きく置く */}
        <p className="mt-3 text-4xl leading-none font-semibold">
          <SharedElement name={sharedName.amount(genreKey)}>
            <span>
              <RollingNumber value={totalYen} />
            </span>
          </SharedElement>
        </p>

        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          aria-label={`期間、${monthLabel}。タップで期間を選ぶ`}
          onClick={() => setMenuOpen(true)}
          className="tabular mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold"
          style={{ color: 'var(--ink-secondary)', opacity: pending ? 0.5 : 1 }}
        >
          <span aria-live="polite">{monthLabel}</span>
          <span aria-hidden>▾</span>
        </button>
      </header>

      <BottomSheet open={menuOpen} onClose={() => setMenuOpen(false)} role="dialog">
        <div
          role="listbox"
          aria-label="期間を選ぶ"
          className="max-h-[60dvh] overflow-y-auto px-2 pb-2"
        >
          {monthChoices(todayMonthKey).map((m) => (
            <button
              key={m.key}
              type="button"
              role="option"
              aria-selected={m.key === monthKey}
              onClick={() => {
                setMenuOpen(false);
                if (m.key !== monthKey) go(m.key);
              }}
              className="flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left text-base font-semibold"
              style={{ color: 'var(--ink)' }}
            >
              <span className="tabular">{m.label}</span>
              {m.key === monthKey ? <span aria-hidden>✓</span> : null}
            </button>
          ))}
        </div>
      </BottomSheet>
    </>
  );
}
