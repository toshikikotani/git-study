'use client';

/**
 * 月のレポートのドーナツグラフ(N4)。中央に合計金額、区切りをタップすると
 * そのジャンルを強調して中央の表示をそのジャンルの金額・割合に切り替える。
 * 小さい区切りにはラベルを付けず(文字の重なりを作らない)、下の一覧で示す。
 *
 * 色はジャンル詳細・ジャンル内訳(genre-style.ts)と同じ genreColorVar() を
 * 使う(N4本人要件「カテゴリの色は、全画面で同じ色を使う」)。
 */

import { useState } from 'react';
import type { Route } from 'next';
import Link from 'next/link';

import { GenreBadge } from '@/components/ui/genre-badge';
import { genreColorVar } from '@/domain/genre-style';
import { formatYen } from '@/domain/money';
import { categoryHref } from '@/lib/category-nav';

export type GenreDonutRow = {
  genreId: string | null;
  name: string;
  spentYen: number;
};

const SIZE = 200;
const STROKE = 28;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function GenreDonutChart({
  rows,
  monthKey,
}: {
  rows: readonly GenreDonutRow[];
  monthKey: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const total = rows.reduce((sum, r) => sum + r.spentYen, 0);
  const sorted = [...rows].filter((r) => r.spentYen > 0).sort((a, b) => b.spentYen - a.spentYen);

  if (total === 0) {
    return (
      <div
        className="glass rounded-[22px] p-5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          ジャンル別の内訳
        </h2>
        <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
          この月の支出はありません。
        </p>
      </div>
    );
  }

  const active = sorted.find((r) => (r.genreId ?? 'none') === selected) ?? null;
  const centerLabel = active ? active.name : `${monthKey.slice(5, 7)}月の支出`;
  const centerAmount = active ? active.spentYen : total;
  const centerRatio = active ? active.spentYen / total : null;

  const segments = sorted.reduce<
    { key: string; name: string; spentYen: number; ratio: number; dash: number; offset: number }[]
  >((acc, r) => {
    const key = r.genreId ?? 'none';
    const ratio = r.spentYen / total;
    const dash = ratio * CIRCUMFERENCE;
    const prevOffset = acc.length > 0 ? acc[acc.length - 1]!.offset + acc[acc.length - 1]!.dash : 0;
    acc.push({ key, name: r.name, spentYen: r.spentYen, ratio, dash, offset: prevOffset });
    return acc;
  }, []);

  return (
    <div
      className="glass rounded-[22px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        ジャンル別の内訳
      </h2>

      <div className="mt-3 flex justify-center">
        <div className="relative" style={{ width: SIZE, height: SIZE }}>
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            width={SIZE}
            height={SIZE}
            role="img"
            aria-label={`${monthKey}のジャンル別内訳:${sorted.map((r) => `${r.name} ${formatYen(r.spentYen, { sign: 'never' })}`).join('、')}`}
          >
            <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
              {segments.map((seg) => {
                const isSelected = selected === seg.key;
                const isDimmed = selected !== null && !isSelected;
                return (
                  <circle
                    key={seg.key}
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={RADIUS}
                    fill="none"
                    stroke={genreColorVar(seg.name)}
                    strokeWidth={isSelected ? STROKE + 6 : STROKE}
                    strokeDasharray={`${seg.dash} ${CIRCUMFERENCE - seg.dash}`}
                    strokeDashoffset={-seg.offset}
                    opacity={isDimmed ? 0.35 : 1}
                    className="cursor-pointer"
                    style={{ transition: 'stroke-width var(--duration-fast, 120ms) ease-out' }}
                    onClick={() => setSelected((prev) => (prev === seg.key ? null : seg.key))}
                  >
                    <title>{`${seg.name} ${formatYen(seg.spentYen, { sign: 'never' })}(${Math.round(seg.ratio * 100)}%)`}</title>
                  </circle>
                );
              })}
            </g>
          </svg>
          <div
            className="pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center text-center"
            style={{ width: SIZE - STROKE * 2 - 16 }}
          >
            <span className="text-[11px] leading-tight" style={{ color: 'var(--ink-muted)' }}>
              {centerLabel}
            </span>
            <span
              className="tabular text-base leading-none font-semibold"
              style={{ color: 'var(--ink)' }}
            >
              {formatYen(centerAmount, { sign: 'never' })}
            </span>
            {centerRatio !== null ? (
              <span className="tabular text-xs" style={{ color: 'var(--ink-muted)' }}>
                {Math.round(centerRatio * 100)}%
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <ul className="mt-3 space-y-1">
        {sorted.map((r) => {
          const key = r.genreId ?? 'none';
          const ratio = r.spentYen / total;
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => setSelected((prev) => (prev === key ? null : key))}
                aria-pressed={selected === key}
                className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left"
                style={{ background: selected === key ? 'var(--plane)' : 'transparent' }}
              >
                <GenreBadge name={r.name} size={20} />
                <span className="min-w-0 flex-1 truncate text-sm" style={{ color: 'var(--ink)' }}>
                  {r.name}
                </span>
                <span className="tabular text-sm" style={{ color: 'var(--ink-secondary)' }}>
                  {formatYen(r.spentYen, { sign: 'never' })}
                </span>
                <span
                  className="tabular w-10 shrink-0 text-right text-xs"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  {Math.round(ratio * 100)}%
                </span>
                <Link
                  href={categoryHref(key, monthKey) as Route}
                  aria-label={`${r.name}の詳細`}
                  className="min-h-11 min-w-11 flex shrink-0 items-center justify-center"
                  style={{ color: 'var(--ink-muted)' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span aria-hidden>›</span>
                </Link>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
