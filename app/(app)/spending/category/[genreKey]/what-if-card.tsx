'use client';

import { useState, useTransition } from 'react';

import {
  formatEstimate,
  formatEstimateRange,
  formatProbability,
  formatSignedEstimate,
  formatTimesInTen,
} from '@/domain/forecast/format';
import type { CategoryWhatIfView } from '@/features/forecast/what-if';
import { formatYen } from '@/domain/money';
import { decideCategoryPromiseAction } from '../actions';

const LABELS = ['いつも通り', '週1回へらす', '週2回へらす'] as const;

function labelOf(perWeek: number): string {
  return LABELS[perWeek] ?? `週${perWeek}回へらす`;
}

/** 「10回中○回」を10個の点で。点は塗り/点線の枠でも区別する(色だけにしない)。 */
function TenDots({ p, tone }: { p: number; tone: 'over' | 'ok' }) {
  const filled = Math.min(10, Math.max(0, Math.round(p * 10)));
  const color = tone === 'over' ? 'var(--state-caution)' : 'var(--state-ok)';
  return (
    <span aria-hidden className="flex gap-1">
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          className="size-2 rounded-full"
          style={
            i < filled
              ? { background: color }
              : { border: '1px dashed var(--ink-muted)', opacity: 0.8 }
          }
        />
      ))}
    </span>
  );
}

/**
 * ジャンル画面の「もし、へらしたら」(デザインのジャンルの試算)。いつも通り・週1回・週2回を
 * 選ぶと、そのジャンルの月末の見込み・目標を超える回数・全体で予算に収まる回数・月末の収支が
 * 切り替わる。数字はすべて予測と同じ試行から出した目安。
 */
export function WhatIfCard({ view }: { view: CategoryWhatIfView }) {
  const promisedIndex =
    view.promise === null ? -1 : view.options.findIndex((o) => o.perWeek === view.promise!.perWeek);
  const [selected, setSelected] = useState(Math.max(0, promisedIndex));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const option = view.options[selected] ?? view.options[0]!;
  const usual = view.options[0]!;
  const gap = view.targetYen === null ? null : option.landing.p50 - view.targetYen;
  const pct = (v: number) => {
    const scale = Math.max(usual.landing.p90, view.targetYen ?? 0) * 1.1;
    return `${Math.min(100, Math.max(0, (v / Math.max(1, scale)) * 100))}%`;
  };

  return (
    <section
      aria-label={`もし、${view.categoryName}をへらしたら`}
      className="space-y-4 rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
          もし、{view.categoryName}をへらしたら
        </h2>
        {view.provisional ? (
          <span
            className="rounded-full px-2 py-1 text-xs font-semibold"
            style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
          >
            目安
          </span>
        ) : null}
      </div>

      <div role="radiogroup" aria-label="へらす回数" className="grid grid-cols-3 gap-2">
        {view.options.map((o, i) => {
          const on = i === selected;
          return (
            <button
              key={o.perWeek}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setSelected(i)}
              className="min-h-11 rounded-full px-2 text-sm font-semibold"
              style={{
                background: on ? 'var(--accent)' : 'var(--plane)',
                color: on ? 'var(--on-accent)' : 'var(--ink)',
              }}
            >
              {labelOf(o.perWeek)}
              {i === promisedIndex ? <span className="sr-only">(約束中)</span> : null}
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="space-y-4">
        <div>
          <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            {view.categoryName}の月末の見込み
          </p>
          <p className="tabular mt-1 text-2xl font-semibold" style={{ color: 'var(--ink)' }}>
            {formatEstimate(option.landing.p50)}
          </p>
          <p className="tabular mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            10回中8回は {formatEstimateRange(option.landing.p10, option.landing.p90)}
            {gap === null
              ? ''
              : gap > 0
                ? ` · 目標を ${formatEstimate(gap)}超えそう`
                : ` · 目標まで ${formatEstimate(-gap)}`}
          </p>
          <div aria-hidden className="relative mt-3 h-4">
            <div
              className="absolute inset-x-0 top-1 h-2 rounded-full"
              style={{ background: 'var(--plane)' }}
            />
            <div
              className="absolute top-1 h-2 rounded-full"
              style={{
                left: pct(option.landing.p10),
                width: `calc(${pct(option.landing.p90)} - ${pct(option.landing.p10)})`,
                background: 'var(--state-ok-track)',
              }}
            />
            {view.targetYen !== null ? (
              <div
                className="absolute top-0 h-4"
                style={{ left: pct(view.targetYen), width: 2, background: 'var(--ink)' }}
              />
            ) : null}
            <div
              className="absolute top-0 size-4 rounded-full"
              style={{
                left: `calc(${pct(option.landing.p50)} - 8px)`,
                background: gap !== null && gap > 0 ? 'var(--state-caution)' : 'var(--state-ok)',
                boxShadow: '0 0 0 2px var(--surface)',
              }}
            />
          </div>
        </div>

        <dl className="space-y-3 text-sm">
          {option.exceedance !== null ? (
            <div className="flex items-center justify-between gap-3">
              <dt style={{ color: 'var(--ink-secondary)' }}>{view.categoryName}が目標を超える</dt>
              <dd className="flex items-center gap-2" style={{ color: 'var(--ink)' }}>
                <TenDots p={option.exceedance} tone="over" />
                <span className="tabular font-semibold">{formatTimesInTen(option.exceedance)}</span>
              </dd>
            </div>
          ) : null}
          {option.probWithinBudget !== null ? (
            <div className="flex items-center justify-between gap-3">
              <dt style={{ color: 'var(--ink-secondary)' }}>全体で予算に収まる</dt>
              <dd className="flex items-center gap-2" style={{ color: 'var(--ink)' }}>
                <TenDots p={option.probWithinBudget} tone="ok" />
                <span className="tabular font-semibold">
                  {formatTimesInTen(option.probWithinBudget)}
                </span>
              </dd>
            </div>
          ) : null}
          {view.balanceP50 !== null ? (
            <div className="flex items-center justify-between gap-3">
              <dt style={{ color: 'var(--ink-secondary)' }}>月末の収支の見込み</dt>
              <dd className="tabular font-semibold" style={{ color: 'var(--ink)' }}>
                {formatSignedEstimate(view.balanceP50 + option.savedYen)}
              </dd>
            </div>
          ) : null}
        </dl>

        {selected > 0 ? (
          <p role="status" className="text-sm" style={{ color: 'var(--ink)' }}>
            {labelOf(option.perWeek)}と、{formatEstimate(option.savedYen)}少なくなる見込み
            {option.probWithinBudget !== null && usual.probWithinBudget !== null
              ? `。予算に収まる確率 ${formatProbability(usual.probWithinBudget)} → ${formatProbability(option.probWithinBudget)}`
              : ''}
          </p>
        ) : null}
      </div>

      <PromiseBlock
        view={view}
        selectedPerWeek={option.perWeek}
        pending={pending}
        error={error}
        onDecide={(perWeek) => {
          setError(null);
          startTransition(async () => {
            const result = await decideCategoryPromiseAction(view.genreId, perWeek);
            if (result.error) setError(result.error);
          });
        }}
      />

      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        1回 {formatEstimate(view.perVisitYen)} × 月末まで約{view.weeks.toFixed(1)}
        週で計算した目安です。決めた回数は見込みに入り、月末に守れたかを見せます。
      </p>
    </section>
  );
}

/**
 * 約束(「決める」、ADR-075):今月の約束と使った額、先月の約束が守れたか、決める・変える・
 * やめるボタン。選んだ選択肢が今の約束と同じならボタンは出さない。
 */
function PromiseBlock({
  view,
  selectedPerWeek,
  pending,
  error,
  onDecide,
}: {
  view: CategoryWhatIfView;
  selectedPerWeek: number;
  pending: boolean;
  error: string | null;
  onDecide: (perWeek: number | null) => void;
}) {
  const current = view.promise?.perWeek ?? 0;
  const action =
    selectedPerWeek === current
      ? null
      : selectedPerWeek === 0
        ? { label: '約束をやめる(いつも通りに戻す)', perWeek: null }
        : current === 0
          ? { label: `${labelOf(selectedPerWeek)}と決める`, perWeek: selectedPerWeek }
          : { label: `${labelOf(selectedPerWeek)}に変える`, perWeek: selectedPerWeek };
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return (
    <div className="space-y-2">
      {view.lastMonth !== null ? (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
          先月の約束({labelOf(view.lastMonth.promise.perWeek)}):
          <span className="font-semibold">
            {view.lastMonth.kept ? '守れました' : '守れませんでした'}
          </span>
          <span className="tabular block text-xs" style={{ color: 'var(--ink-secondary)' }}>
            使った {formatYen(view.lastMonth.spentYen, { sign: 'never' })} / 約束どおりなら{' '}
            {formatEstimate(view.lastMonth.promise.limitYen)}まで
          </span>
        </p>
      ) : null}
      {view.promise !== null ? (
        <p
          role="status"
          className="rounded-xl px-3 py-2 text-sm leading-relaxed"
          style={{ background: 'var(--plane)', color: 'var(--ink)' }}
        >
          {labelOf(view.promise.perWeek)}約束を見込みに入れています({md(view.promise.promisedOn)}
          から)
          <span className="tabular block text-xs" style={{ color: 'var(--ink-secondary)' }}>
            今月の{view.categoryName}:使った {formatYen(view.spentThisMonthYen, { sign: 'never' })}{' '}
            / 約束どおりなら {formatEstimate(view.promise.limitYen)}まで
          </span>
        </p>
      ) : null}
      {action !== null ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => onDecide(action.perWeek)}
          className="min-h-12 w-full rounded-full text-base font-semibold disabled:opacity-60"
          style={{ background: 'var(--action)', color: 'var(--on-action)' }}
        >
          {pending ? '保存しています…' : action.label}
        </button>
      ) : null}
      {error !== null ? (
        <p role="alert" className="text-sm" style={{ color: 'var(--state-over)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
