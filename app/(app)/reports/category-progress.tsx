'use client';

import { useState } from 'react';

import { GenreBadge } from '@/components/ui/genre-badge';
import { formatEstimate } from '@/domain/forecast/format';
import { useOpenCategory } from '../category-sheet';
import { setTargetsFromOutlookAction } from './progress-actions';

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

/** 目標なしのカテゴリ(「期間中の支出から追加」で、使った額がそのまま目標だった行、ADR-108)。 */
export type UntargetedRow = {
  genreId: string;
  name: string;
  spentYen: number;
  p50: number | null;
  fixed: boolean;
};

const yen = (v: number) => `${Math.round(v).toLocaleString('ja-JP')}円`;

const TONES = {
  over: { label: 'こえた', color: 'var(--state-over)', bg: 'var(--state-over-track)' },
  risk: { label: 'こえそう', color: 'var(--state-caution)', bg: 'var(--state-caution-track)' },
  ok: { label: '順調', color: 'var(--income)', bg: 'var(--income-track)' },
} as const;

/**
 * カテゴリの進み具合(デザイン v3-6、ADR-108):気をつけたい(こえた・こえそう)/ 順調 / 目標なし。
 * 目標なしは「期間中の支出から追加」で使った額がそのまま目標になっていたもの。こえたと誤って出ないよう、
 * 見込みだけを出し、「見込みに合わせて目標をつける」で目標にできる。行を押すとそのカテゴリ(⑦)。
 */
export function CategoryProgress({
  rows,
  untargeted = [],
}: {
  rows: readonly ProgressRow[];
  untargeted?: readonly UntargetedRow[];
}) {
  const open = useOpenCategory();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (rows.length === 0 && untargeted.length === 0) return null;
  const watch = rows
    .filter((r) => r.tone !== 'ok')
    .sort((a, b) => (a.tone === b.tone ? b.spentYen - a.spentYen : a.tone === 'over' ? -1 : 1));
  const ok = rows.filter((r) => r.tone === 'ok').sort((a, b) => b.spentYen - a.spentYen);

  const setTargets = async () => {
    setPending(true);
    setError(null);
    const result = await setTargetsFromOutlookAction();
    setPending(false);
    if (result.error) {
      setError(result.error);
    }
  };

  return (
    <div className="flex flex-col gap-3" style={{ color: 'var(--ink)' }}>
      {watch.length > 0 ? (
        <Group title="気をつけたい" count={`${watch.length}`}>
          {watch.map((r, i) => {
            const tone = TONES[r.tone];
            const note =
              r.tone === 'over'
                ? r.fixed
                  ? '固定費'
                  : r.p50 !== null && r.p50 > r.spentYen
                    ? `見込み ${formatEstimate(r.p50)}`
                    : `${yen(r.spentYen - r.targetYen)}オーバー`
                : r.p50 !== null
                  ? `見込み ${formatEstimate(r.p50)}`
                  : '';
            return (
              <Row key={r.genreId} first={i === 0}>
                <button
                  type="button"
                  onClick={() => open(r.genreId)}
                  className="flex min-h-14 w-full gap-3 px-4 py-3 text-left"
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
                    <Bar spentYen={r.spentYen} p50={r.p50} targetYen={r.targetYen} />
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
              </Row>
            );
          })}
        </Group>
      ) : null}

      {ok.length > 0 ? (
        <Group title="順調" count={`${ok.length} · 目標内の見込み`}>
          {ok.map((r, i) => (
            <Row key={r.genreId} first={i === 0}>
              <button
                type="button"
                onClick={() => open(r.genreId)}
                className="flex min-h-13 w-full items-center gap-3 px-4 py-2 text-left"
                aria-label={`${r.name}、順調。${yen(r.spentYen)} / 目標 ${yen(r.targetYen)}`}
              >
                <GenreBadge name={r.name} size={32} />
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="truncate text-[15px] font-medium">{r.name}</span>
                  <Bar spentYen={r.spentYen} p50={r.p50} targetYen={r.targetYen} />
                </span>
                <span
                  className="tabular shrink-0 text-right text-[12px] leading-snug"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  {yen(r.spentYen)}
                  <br />/ {yen(r.targetYen)}
                </span>
              </button>
            </Row>
          ))}
        </Group>
      ) : null}

      {untargeted.length > 0 ? (
        <Group title="目標なし" count={`${untargeted.length} · 見込みだけ表示`}>
          <p
            className="px-4 pt-3 pb-1 text-[13px] leading-normal"
            style={{ color: 'var(--ink-muted)' }}
          >
            「期間中の支出から追加」で、使った額がそのまま目標になっていたものです。こえたと誤って出ないよう、目標なしとして扱います。
          </p>
          {untargeted.map((r) => (
            <Row key={r.genreId} first={false}>
              <button
                type="button"
                onClick={() => open(r.genreId)}
                className="flex min-h-13 w-full items-center gap-3 px-4 py-2 text-left"
              >
                <GenreBadge name={r.name} size={32} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{r.name}</span>
                <span
                  className="tabular shrink-0 text-[12px]"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  {yen(r.spentYen)} ·{' '}
                  {r.fixed ? '固定費' : r.p50 !== null ? `見込み ${formatEstimate(r.p50)}` : '—'}
                </span>
              </button>
            </Row>
          ))}
          <div className="px-4 pt-2 pb-4">
            <button
              type="button"
              onClick={() => void setTargets()}
              disabled={pending}
              className="min-h-11 w-full rounded-full text-[15px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--plane)', color: 'var(--accent)' }}
            >
              {pending ? '目標をつけています…' : '見込みに合わせて目標をつける'}
            </button>
            {error ? (
              <p role="alert" className="pt-2 text-[13px]" style={{ color: 'var(--over)' }}>
                {error}
              </p>
            ) : null}
          </div>
        </Group>
      ) : null}

      <div className="flex gap-4 px-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
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
    </div>
  );
}

function Group({
  title,
  count,
  children,
}: {
  title: string;
  count: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex flex-col rounded-[22px] pt-4"
      style={{ background: 'var(--surface)' }}
    >
      <div className="flex items-baseline justify-between gap-2 px-4 pb-2">
        <h3 className="text-[17px] font-semibold">{title}</h3>
        <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          {count}
        </span>
      </div>
      {children}
    </section>
  );
}

function Row({ first, children }: { first: boolean; children: React.ReactNode }) {
  return (
    <div style={first ? undefined : { borderTop: '1px solid var(--hairline)' }}>{children}</div>
  );
}

/** 使った額・見込みの帯と、目標の目盛り(ホームの気をつけたいカテゴリでも使う)。 */
export function Bar({
  spentYen,
  p50,
  targetYen,
}: {
  spentYen: number;
  p50: number | null;
  targetYen: number;
}) {
  const scale = Math.max(spentYen, targetYen, p50 ?? 0, 1);
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  return (
    <span aria-hidden className="relative h-2 rounded-full" style={{ background: 'var(--track)' }}>
      {p50 !== null ? (
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: pct(p50), background: 'var(--suggest-line)' }}
        />
      ) : null}
      <span
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: pct(spentYen), background: 'var(--accent)' }}
      />
      <span
        className="absolute -top-1 h-4 w-0.5 rounded-sm"
        style={{ left: `calc(${pct(targetYen)} - 1px)`, background: 'var(--ink)' }}
      />
    </span>
  );
}
