'use client';

import { useState, useTransition } from 'react';

import { TenDots } from '@/components/ui/ten-dots';
import {
  estimateParts,
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

/** 約束の名前(0 は「これ以上は使わない」、ADR-078)。 */
function promiseLabel(perWeek: number): string {
  return perWeek === 0 ? 'これ以上は使わない' : labelOf(perWeek);
}

/** 濃い面(「もし」のカード)の上の文字と線。テーマが変わっても面との対比を保つ。 */
const ON_DARK = 'var(--surface)';
const ON_DARK_SOFT = 'color-mix(in srgb, var(--surface) 78%, transparent)';
const ON_DARK_LINE = 'color-mix(in srgb, var(--surface) 30%, transparent)';

/**
 * ジャンル画面の「もし、へらしたら」(デザインのジャンルの試算)。上はそのジャンルの月末の
 * 見込み(使った・予定・自由に使える残り)、下は濃い面の試算(いつも通り・週1回・週2回)。
 * 選んだ選択肢で、上の見込みと、目標を超える回数・全体で予算に収まる回数・月末の収支が
 * 切り替わる。数字はすべて予測と同じ試行から出した目安。
 */
export function WhatIfCard({ view }: { view: CategoryWhatIfView }) {
  const stopPromised = view.promise?.perWeek === 0;
  const promisedIndex =
    view.promise === null || stopPromised
      ? -1
      : view.options.findIndex((o) => o.perWeek === view.promise!.perWeek);
  const [selected, setSelected] = useState(Math.max(0, promisedIndex));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const option = view.options[selected] ?? view.options[0]!;
  const decide = (perWeek: number | null) => {
    setError(null);
    startTransition(async () => {
      const result = await decideCategoryPromiseAction(view.genreId, perWeek);
      if (result.error) setError(result.error);
    });
  };
  const usual = view.options[0]!;
  const gap = view.targetYen === null ? null : option.landing.p50 - view.targetYen;
  const pct = (v: number) => {
    const scale = Math.max(usual.landing.p90, view.targetYen ?? 0) * 1.1;
    return `${Math.min(100, Math.max(0, (v / Math.max(1, scale)) * 100))}%`;
  };
  const parts = estimateParts(option.landing.p50);
  const committed = view.spentYen + view.scheduledYen;
  const freeYen = view.targetYen === null ? null : view.targetYen - committed;

  return (
    <>
      <section
        aria-label={`${view.categoryName}の月末の見込み`}
        aria-live="polite"
        className="space-y-3 rounded-[28px] p-5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-secondary)' }}>
            月末の見込み{selected > 0 ? `(${labelOf(option.perWeek)}と)` : ''}
          </h2>
          {view.provisional ? (
            <span
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
            >
              目安
            </span>
          ) : null}
        </div>
        <p className="tabular flex items-baseline gap-1" style={{ color: 'var(--ink)' }}>
          <span className="text-base font-semibold" style={{ color: 'var(--ink-secondary)' }}>
            約
          </span>
          <span className="text-4xl leading-none font-semibold tracking-[-0.03em]">
            {parts.number}
          </span>
          <span className="text-xl font-semibold">{parts.unit}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {gap !== null ? (
            <span
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                background: gap > 0 ? 'var(--state-caution-track)' : 'var(--state-ok-track)',
                color: 'var(--ink)',
              }}
            >
              {gap > 0
                ? `このままだと ${formatEstimate(gap)}オーバー`
                : `目標まで ${formatEstimate(-gap)}の余裕`}
            </span>
          ) : null}
          <span className="tabular text-sm" style={{ color: 'var(--ink-secondary)' }}>
            10回中8回は {formatEstimateRange(option.landing.p10, option.landing.p90)}
          </span>
        </div>
        <div aria-hidden className="relative mt-1 h-10">
          <div
            className="absolute inset-x-0 top-5 h-2 rounded-full"
            style={{ background: 'var(--plane)' }}
          />
          <div
            className="absolute top-5 h-2 rounded-full"
            style={{
              left: pct(option.landing.p10),
              width: `calc(${pct(option.landing.p90)} - ${pct(option.landing.p10)})`,
              background: 'var(--state-ok-track)',
            }}
          />
          <div
            className="absolute top-5 left-0 h-2 rounded-full"
            style={{ width: pct(view.spentYen), background: 'var(--ink-secondary)' }}
          />
          {view.targetYen !== null ? (
            <>
              <div
                className="absolute top-3 h-6"
                style={{ left: pct(view.targetYen), width: 2, background: 'var(--ink)' }}
              />
              <span
                className="absolute top-0 -translate-x-1/2 text-xs leading-none font-semibold"
                style={{ left: pct(view.targetYen), color: 'var(--ink)' }}
              >
                目標
              </span>
            </>
          ) : null}
          <div
            className="absolute top-4 size-4 rounded-full"
            style={{
              left: `calc(${pct(option.landing.p50)} - 8px)`,
              background: gap !== null && gap > 0 ? 'var(--state-caution)' : 'var(--state-ok)',
              boxShadow: '0 0 0 2px var(--surface)',
            }}
          />
        </div>
        <dl
          className="grid grid-cols-3 gap-2 pt-3"
          style={{ borderTop: '1px solid var(--hairline)' }}
        >
          <div>
            <dt className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
              使った
            </dt>
            <dd className="tabular text-base font-semibold" style={{ color: 'var(--ink)' }}>
              {formatYen(view.spentYen, { sign: 'never' })}
            </dd>
          </div>
          <div>
            <dt className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
              予定
            </dt>
            <dd className="tabular text-base font-semibold" style={{ color: 'var(--ink)' }}>
              {formatYen(view.scheduledYen, { sign: 'never' })}
            </dd>
          </div>
          {freeYen !== null ? (
            <div>
              <dt className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
                自由に使える残り
              </dt>
              <dd className="tabular text-base font-semibold" style={{ color: 'var(--ink)' }}>
                {freeYen >= 0
                  ? formatYen(freeYen, { sign: 'never' })
                  : `${formatYen(-freeYen, { sign: 'never' })} 超え`}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section
        aria-label={`もし、${view.categoryName}をへらしたら`}
        className="space-y-4 rounded-[28px] p-5"
        style={{ background: 'var(--ink)', color: ON_DARK }}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">もし、{view.categoryName}をへらしたら</h2>
          {view.provisional ? (
            <span
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{ background: ON_DARK_LINE, color: ON_DARK }}
            >
              目安
            </span>
          ) : null}
        </div>

        <div
          role="radiogroup"
          aria-label={`${view.categoryName}の回数`}
          className="grid grid-cols-3 gap-1 rounded-2xl p-1"
          style={{ background: ON_DARK_LINE }}
        >
          {view.options.map((o, i) => {
            const on = i === selected;
            return (
              <button
                key={o.perWeek}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setSelected(i)}
                className="min-h-11 rounded-xl px-1 text-sm font-semibold"
                style={{
                  background: on ? ON_DARK : 'transparent',
                  color: on ? 'var(--ink)' : ON_DARK_SOFT,
                }}
              >
                {labelOf(o.perWeek)}
                {i === promisedIndex ? <span className="sr-only">(約束中)</span> : null}
              </button>
            );
          })}
        </div>

        <dl aria-live="polite" className="space-y-4 text-sm">
          {option.exceedance !== null ? (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <dt style={{ color: ON_DARK_SOFT }}>{view.categoryName}が目標を超える</dt>
                <dd className="tabular text-base font-semibold">
                  {formatTimesInTen(option.exceedance)}
                </dd>
              </div>
              <TenDots
                probability={option.exceedance}
                color="var(--state-caution)"
                ring={ON_DARK_SOFT}
              />
            </div>
          ) : null}
          {option.probWithinBudget !== null ? (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <dt style={{ color: ON_DARK_SOFT }}>全体で予算に収まる</dt>
                <dd className="tabular text-base font-semibold">
                  {formatTimesInTen(option.probWithinBudget)}
                </dd>
              </div>
              <TenDots probability={option.probWithinBudget} color={ON_DARK} ring={ON_DARK_SOFT} />
            </div>
          ) : null}
          {view.balanceP50 !== null ? (
            <div
              className="flex items-baseline justify-between gap-3 pt-3"
              style={{ borderTop: `1px solid ${ON_DARK_LINE}` }}
            >
              <dt style={{ color: ON_DARK_SOFT }}>月末の収支の見込み</dt>
              <dd className="tabular text-xl font-semibold">
                {formatSignedEstimate(view.balanceP50 + option.savedYen)}
              </dd>
            </div>
          ) : null}
        </dl>

        {selected > 0 ? (
          <p role="status" className="text-sm">
            {labelOf(option.perWeek)}と、{formatEstimate(option.savedYen)}少なくなる見込み
            {option.probWithinBudget !== null && usual.probWithinBudget !== null
              ? `。予算に収まる確率 ${formatProbability(usual.probWithinBudget)} → ${formatProbability(option.probWithinBudget)}`
              : ''}
          </p>
        ) : null}

        <p className="text-xs leading-relaxed" style={{ color: ON_DARK_SOFT }}>
          1回 {formatEstimate(view.perVisitYen)} × 月末まで約{view.weeks.toFixed(1)}
          週で計算した目安です。決めた回数は見込みに入り、月末に守れたかを見せます。
        </p>

        <PromiseBlock
          view={view}
          selectedPerWeek={option.perWeek}
          pending={pending}
          error={error}
          onDecide={decide}
        />
      </section>

      <StopCard view={view} pending={pending} onDecide={decide} />
    </>
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
  // 「これ以上は使わない」の約束中は、どの選択肢を選んでも「変える」「やめる」になる。
  const current =
    view.promise === null ? 0 : view.promise.perWeek === 0 ? -1 : view.promise.perWeek;
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
        <p className="text-sm leading-relaxed">
          先月の約束({promiseLabel(view.lastMonth.promise.perWeek)}):
          <span className="font-semibold">
            {view.lastMonth.kept ? '守れました' : '守れませんでした'}
          </span>
          <span className="tabular block text-xs" style={{ color: ON_DARK_SOFT }}>
            使った {formatYen(view.lastMonth.spentYen, { sign: 'never' })} / 約束どおりなら{' '}
            {formatEstimate(view.lastMonth.promise.limitYen)}まで
          </span>
        </p>
      ) : null}
      {view.promise !== null && view.promise.perWeek > 0 ? (
        <p
          role="status"
          className="rounded-xl px-3 py-2 text-sm leading-relaxed"
          style={{ background: ON_DARK_LINE }}
        >
          {labelOf(view.promise.perWeek)}約束を見込みに入れています({md(view.promise.promisedOn)}
          から)
          <span className="tabular block text-xs" style={{ color: ON_DARK_SOFT }}>
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
          style={{ background: ON_DARK, color: 'var(--ink)' }}
        >
          {pending ? '保存しています…' : action.label}
        </button>
      ) : null}
      {error !== null ? (
        <p
          role="alert"
          className="rounded-xl px-3 py-2 text-sm"
          style={{ background: 'var(--surface)', color: 'var(--state-over)' }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * これ以上は使わない(デザインのジャンル画面、ADR-078):「守れたとき」(月末まで使わない)と
 * 「いつもの守り方」(これまでの約束の守れ具合の割合だけ減る)の2つの見込みを並べ、決める・やめる。
 * 決めると、全画面の見込みには「いつもの守り方」が入る。
 */
function StopCard({
  view,
  pending,
  onDecide,
}: {
  view: CategoryWhatIfView;
  pending: boolean;
  onDecide: (perWeek: number | null) => void;
}) {
  const active = view.promise?.perWeek === 0;
  const { kept, usual, keepRate } = view.stop;
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const column = (title: string, note: string, o: typeof kept) => (
    <div className="space-y-1 rounded-2xl p-3" style={{ background: 'var(--plane)' }}>
      <p className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
        {title}
      </p>
      <p className="tabular text-lg font-semibold" style={{ color: 'var(--ink)' }}>
        {formatEstimate(o.landing.p50)}
      </p>
      {o.probWithinBudget !== null ? (
        <p className="tabular text-xs" style={{ color: 'var(--ink-secondary)' }}>
          予算に収まる {formatTimesInTen(o.probWithinBudget)}
        </p>
      ) : null}
      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        {note}
      </p>
    </div>
  );
  return (
    <section
      aria-label="これ以上は使わない"
      className="space-y-3 rounded-[24px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
            これ以上は使わない
          </h2>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            「守れたとき」と「いつもの守り方」の2つの見込みを出します
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => onDecide(active ? null : 0)}
          className="min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold disabled:opacity-60"
          style={{ border: '1.5px solid var(--hairline)', color: 'var(--ink)' }}
        >
          {active ? 'やめる' : '決める'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {column(`${view.categoryName}を月末まで使わなかったら`, '守れたとき', kept)}
        {column(
          'いつもの守り方なら',
          `これまでの約束は10回中${Math.round(keepRate * 10)}回守れた、として見込む`,
          usual,
        )}
      </div>
      {active && view.promise !== null ? (
        <p
          role="status"
          className="rounded-xl px-3 py-2 text-sm leading-relaxed"
          style={{ background: 'var(--state-ok-track)', color: 'var(--ink)' }}
        >
          これ以上は使わない約束を見込みに入れています({md(view.promise.promisedOn)}から)
          <span className="tabular block text-xs" style={{ color: 'var(--ink-secondary)' }}>
            見込みは「いつもの守り方」。今月の{view.categoryName}:使った{' '}
            {formatYen(view.spentThisMonthYen, { sign: 'never' })} / 約束どおりなら{' '}
            {formatEstimate(view.promise.limitYen)}まで
          </span>
        </p>
      ) : null}
    </section>
  );
}
