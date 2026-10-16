'use client';

import { useState } from 'react';

import { GenreBadge } from '@/components/ui/genre-badge';
import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { formatEstimate } from '@/domain/forecast/format';
import { useOpenCategory } from '../category-sheet';

export type ProgressRow = {
  genreId: string;
  name: string;
  spentYen: number;
  targetYen: number;
  p50: number | null;
  fixed: boolean;
  /** over:使った額で目標をこえた。risk:このままだとこえそう。ok:順調。 */
  tone: 'over' | 'risk' | 'ok';
};

/** はじめから出す行の数(こえた・こえそうは必ず出す)。 */
const MIN_SHOWN = 4;
const yen = (v: number) => `${Math.round(v).toLocaleString('ja-JP')}円`;

const TONES = {
  over: { label: 'こえた', color: 'var(--state-over)', bg: 'var(--state-over-track)' },
  risk: { label: 'こえそう', color: 'var(--state-caution)', bg: 'var(--state-caution-track)' },
  ok: { label: '順調', color: 'var(--income)', bg: 'var(--income-track)' },
} as const;

/**
 * カテゴリの進み具合(デザイン仕様書の「分析 › 目標」、ADR-091):こえた・こえそうを上に、使った額と
 * 見込みの帯と目標の目盛り。残りは「ほかNカテゴリ」にたたむ。行を押すとそのカテゴリ(⑦)。
 */
export function CategoryProgress({ rows }: { rows: readonly ProgressRow[] }) {
  const open = useOpenCategory();
  const [showAll, setShowAll] = useState(false);
  const order = { over: 0, risk: 1, ok: 2 } as const;
  const sorted = [...rows].sort((a, b) => order[a.tone] - order[b.tone] || b.spentYen - a.spentYen);
  const flagged = sorted.filter((r) => r.tone !== 'ok').length;
  const shownCount = Math.max(MIN_SHOWN, flagged);
  const shown = showAll ? sorted : sorted.slice(0, shownCount);
  const rest = sorted.slice(shownCount);
  if (rows.length === 0) return null;

  return (
    <section
      aria-labelledby="category-progress"
      className="flex flex-col rounded-[22px] pt-5 pb-2"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <div className="flex items-baseline justify-between gap-2 px-5">
        <h3 id="category-progress" className="text-[17px] font-semibold">
          カテゴリの進み具合
        </h3>
        <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          マークをタップで詳細
        </span>
      </div>
      <ul className="mt-3 flex flex-col">
        {shown.map((r) => {
          const tone = TONES[r.tone];
          const scale = Math.max(r.spentYen, r.targetYen, r.p50 ?? 0, 1);
          const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
          const note =
            r.tone === 'over'
              ? r.fixed
                ? '固定費'
                : `${yen(r.spentYen - r.targetYen)}オーバー`
              : r.p50 !== null
                ? `見込み ${formatEstimate(r.p50)}`
                : '';
          return (
            <li key={r.genreId} style={{ borderTop: '1px solid var(--hairline)' }}>
              <button
                type="button"
                onClick={() => open(r.genreId)}
                className="flex min-h-14 w-full gap-3 px-5 py-3 text-left"
                aria-label={`${r.name}、${tone.label}。${yen(r.spentYen)} / 目標 ${yen(r.targetYen)}`}
              >
                <GenreBadge name={r.name} size={36} />
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[16px] font-medium">{r.name}</span>
                    <span
                      className="shrink-0 rounded-full px-2 py-1 text-[12px] font-bold"
                      style={{ color: tone.color, background: tone.bg }}
                    >
                      {tone.label}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="relative h-2 rounded-full"
                    style={{ background: 'var(--track)' }}
                  >
                    {r.p50 !== null ? (
                      <span
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: pct(r.p50), background: 'var(--suggest-line)' }}
                      />
                    ) : null}
                    <span
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: pct(r.spentYen), background: 'var(--accent)' }}
                    />
                    <span
                      className="absolute -top-1 h-4 w-0.5 rounded-sm"
                      style={{ left: `calc(${pct(r.targetYen)} - 1px)`, background: 'var(--ink)' }}
                    />
                  </span>
                  <span
                    className="tabular flex justify-between gap-2 text-[13px]"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    <span>
                      {yen(r.spentYen)} / 目標 {yen(r.targetYen)}
                    </span>
                    <span>{note}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {rest.length > 0 && !showAll ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="flex min-h-13 items-center justify-between px-5 text-left text-[15px]"
          style={{ borderTop: '1px solid var(--hairline)' }}
        >
          <span>ほか{rest.length}カテゴリ</span>
          <span
            className="flex items-center gap-2 text-[13px] font-semibold"
            style={{ color: 'var(--income)' }}
          >
            すべて順調
            <ChevronRightIcon />
          </span>
        </button>
      ) : null}
      <div className="flex gap-4 px-5 pt-2 pb-3 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
        <span className="flex items-center gap-1">
          <span
            aria-hidden
            className="h-2 w-3 rounded-full"
            style={{ background: 'var(--accent)' }}
          />
          使った額
        </span>
        <span className="flex items-center gap-1">
          <span
            aria-hidden
            className="h-2 w-3 rounded-full"
            style={{ background: 'var(--suggest-line)' }}
          />
          見込み
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden className="h-3 w-0.5" style={{ background: 'var(--ink)' }} />
          目標
        </span>
      </div>
    </section>
  );
}
