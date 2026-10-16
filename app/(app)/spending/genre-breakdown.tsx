'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';

import { useGenreOverrides } from '@/components/ui/genre-style-context';
import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { genreBarColor } from '@/domain/genre-style';
import { formatYen } from '@/domain/money';
import type { GenreBreakdownRow } from '@/features/spending/ledger-types';
import { categoryHref } from '@/lib/category-nav';
import { useJustSaved } from '@/lib/just-saved';
import { useSpendingMonth } from './spending-month-provider';

/**
 * カテゴリ(デザイン仕様書の「分析」、ADR-090):ドーナツ(中央にその月の支出)と、上位5つの
 * 行(色の点・名前・金額・割合)、残りは「ほかNカテゴリ」を押すと開く。数字は domain/ledger.ts の
 * 集計(明細の合計と同じ値)。行を押すと、そのカテゴリの詳細へ。
 */
export function GenreBreakdown() {
  const overrides = useGenreOverrides();
  const { genreBreakdown, isCurrentMonth, loading, visibleMonth } = useSpendingMonth();
  const [showRest, setShowRest] = useState(false);
  const justSaved = useJustSaved().length > 0;

  const rows = genreBreakdown.map((r: GenreBreakdownRow) => ({
    key: r.genreId ?? 'none',
    genreId: r.genreId,
    name: r.genreName,
    spentYen: r.spentYen,
  }));
  const total = rows.reduce((a, r) => a + r.spentYen, 0);
  const sorted = [...rows].filter((r) => r.spentYen > 0).sort((a, b) => b.spentYen - a.spentYen);
  const top = sorted.slice(0, TOP_COUNT);
  const rest = sorted.slice(TOP_COUNT);
  const restYen = rest.reduce((a, r) => a + r.spentYen, 0);
  const monthNumber = Number(visibleMonth.slice(5, 7));
  const colorOf = (r: (typeof rows)[number]) =>
    genreBarColor(
      r.genreId === null ? null : r.name,
      r.genreId === null ? null : overrides[r.name],
    );
  const pct = (yen: number) => `${total > 0 ? Math.round((yen / total) * 100) : 0}%`;

  const row = (r: (typeof rows)[number], i: number) => (
    <li key={r.key}>
      {i > 0 ? <div className="ml-6 h-px" style={{ background: 'var(--hairline)' }} /> : null}
      <Link
        href={categoryHref(r.key, visibleMonth) as Route}
        className="tabular grid min-h-11 grid-cols-[12px_1fr_auto_40px] items-center gap-3 text-[15px]"
        style={{ color: 'var(--ink)' }}
      >
        <span aria-hidden className="size-3 rounded-full" style={{ background: colorOf(r) }} />
        <span className="min-w-0 truncate">{r.name}</span>
        <span className="font-semibold">{formatYen(r.spentYen, { sign: 'never' })}</span>
        <span className="text-right text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          {pct(r.spentYen)}
        </span>
      </Link>
    </li>
  );

  return (
    <section
      aria-labelledby="genre-breakdown"
      className="flex flex-col rounded-[22px] px-4 pt-5 pb-2"
      style={{ background: 'var(--surface)' }}
    >
      <h2
        id="genre-breakdown"
        className="text-[17px] font-semibold"
        style={{ color: 'var(--ink)' }}
      >
        カテゴリ
      </h2>
      {loading && !isCurrentMonth ? (
        <div className="space-y-3 py-4" role="status" aria-label="読み込み中">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-8 animate-pulse rounded-lg"
              style={{ background: 'var(--hairline)' }}
            />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <p className="py-4 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          {isCurrentMonth
            ? 'まだ支出の記録がありません。レシートを撮ると、ここに内訳が出ます。'
            : 'この月の支出はありません。'}
        </p>
      ) : (
        <>
          <Donut
            rows={sorted}
            total={total}
            label={`${monthNumber}月の支出`}
            colorOf={colorOf}
            grow={justSaved}
          />
          <ul className="mt-3 flex flex-col">
            {top.map(row)}
            {showRest ? rest.map((r, i) => row(r, top.length + i)) : null}
          </ul>
          {rest.length > 0 && !showRest ? (
            <>
              <div className="ml-6 h-px" style={{ background: 'var(--hairline)' }} />
              <button
                type="button"
                onClick={() => setShowRest(true)}
                className="tabular grid min-h-11 grid-cols-[12px_1fr_auto_40px] items-center gap-3 text-left text-[15px]"
                style={{ color: 'var(--ink)' }}
              >
                <span
                  aria-hidden
                  className="size-3 rounded-full"
                  style={{ background: 'var(--bar-quiet)' }}
                />
                <span>ほか{rest.length}カテゴリ</span>
                <span className="font-semibold">{formatYen(restYen, { sign: 'never' })}</span>
                <span className="flex justify-end" style={{ color: 'var(--ideal)' }}>
                  <ChevronRightIcon />
                </span>
              </button>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

/** 上位の数(残りは「ほかNカテゴリ」に畳む)。 */
const TOP_COUNT = 5;
const SIZE = 170;
const STROKE = 22;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** ドーナツ(中央に月の支出)。一覧と同じ色・同じ順。 */
function Donut<T extends { key: string; name: string; spentYen: number }>({
  rows,
  total,
  label,
  colorOf,
  grow,
}: {
  rows: readonly T[];
  total: number;
  label: string;
  colorOf: (row: T) => string;
  grow: boolean;
}) {
  const segments = rows
    .filter((r) => r.spentYen > 0)
    .reduce<{ row: T; dash: number; offset: number }[]>((acc, r) => {
      const prev = acc.at(-1);
      acc.push({
        row: r,
        dash: (r.spentYen / Math.max(total, 1)) * CIRCUMFERENCE,
        offset: prev ? prev.offset + prev.dash : 0,
      });
      return acc;
    }, []);
  return (
    <div className="flex justify-center">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={`内訳:${rows.map((r) => `${r.name} ${formatYen(r.spentYen, { sign: 'never' })}`).join('、')}`}
          className={grow ? 'bar-grow' : undefined}
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--state-none-track)"
            strokeWidth={STROKE}
          />
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {segments.map(({ row, dash, offset: o }) => (
              <circle
                key={row.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={colorOf(row)}
                strokeWidth={STROKE}
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeDashoffset={-o}
              />
            ))}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            {label}
          </span>
          <span className="tabular text-[20px] font-bold" style={{ color: 'var(--ink)' }}>
            {formatYen(total, { sign: 'never' })}
          </span>
        </div>
      </div>
    </div>
  );
}
