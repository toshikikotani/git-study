import type { Route } from 'next';
import Link from 'next/link';

import { TenDots } from '@/components/ui/ten-dots';
import {
  estimateParts,
  formatEstimate,
  formatEstimateRange,
  formatProbability,
  formatTimesInTen,
} from '@/domain/forecast/format';
import type { ForecastSuggestion } from '@/domain/forecast/types';
import { categoryHref } from '@/lib/category-nav';

/**
 * 月末の見込みの見出し(デザインの「月末の支出」カード):中央を1つ大きく、予算との差を
 * ひとこと、10回中8回の幅、予算に収まる回数を10個の点で。予算の書き方は「17.0万円」に
 * そろえる(本文・グラフ・注釈で同じ)。
 */
export function LandingHero({
  endLabel,
  landing,
  budgetYen,
  probWithinBudget,
  provisional,
}: {
  /** 「月末」「10月31日」 */
  endLabel: string;
  landing: { p10: number; p50: number; p90: number };
  budgetYen: number | null;
  probWithinBudget: number | null;
  provisional: boolean;
}) {
  const parts = estimateParts(landing.p50);
  const gap = budgetYen === null ? null : landing.p50 - budgetYen;
  const budgetText = budgetYen === null ? '' : formatEstimate(budgetYen, { approx: false });
  return (
    <section
      aria-label={`${endLabel}の支出の見込み`}
      className="space-y-3 rounded-[28px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-secondary)' }}>
          {endLabel}の支出
        </h2>
        {provisional ? (
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
      {gap !== null ? (
        <p
          className="inline-block rounded-full px-3 py-1 text-sm font-semibold"
          style={{
            background: gap > 0 ? 'var(--state-caution-track)' : 'var(--state-ok-track)',
            color: 'var(--ink)',
          }}
        >
          {gap > 0
            ? `予算 ${budgetText}を ${formatEstimate(gap)}超えそう`
            : `予算 ${budgetText}まで ${formatEstimate(-gap)}の余裕`}
        </p>
      ) : null}
      <p className="tabular text-sm" style={{ color: 'var(--ink-secondary)' }}>
        10回中8回は {formatEstimateRange(landing.p10, landing.p90)}
      </p>
      {probWithinBudget !== null ? (
        <div
          className="flex flex-wrap items-center gap-3 pt-3"
          style={{ borderTop: '1px solid var(--hairline)' }}
        >
          <TenDots probability={probWithinBudget} />
          <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
            予算に収まる{' '}
            <span className="font-semibold" style={{ color: 'var(--ink)' }}>
              {formatTimesInTen(probWithinBudget)}
            </span>
            <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              ({formatProbability(probWithinBudget)})
            </span>
          </p>
        </div>
      ) : null}
    </section>
  );
}

/**
 * 次の一手(デザインのホーム・レポート):提案を1つと、そのジャンルの「もし」への入口。
 * 収まる確率がほとんど変わらないなら出さない。
 */
export function NextStepCard({
  suggestion,
  monthKey,
}: {
  suggestion: ForecastSuggestion;
  /** 「2026-10」(ジャンル画面の月) */
  monthKey: string;
}) {
  if (suggestion.probAfter - suggestion.probBefore < 0.01) return null;
  return (
    <section
      aria-label="次の一手"
      className="space-y-2 rounded-[24px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h2 className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
        次の一手
      </h2>
      <p className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
        {suggestion.categoryName}を週{suggestion.perWeek}回へらすと
      </p>
      <p className="tabular text-sm" style={{ color: 'var(--ink-secondary)' }}>
        予算に収まる {formatTimesInTen(suggestion.probBefore)} →{' '}
        <span className="font-semibold" style={{ color: 'var(--ink)' }}>
          {formatTimesInTen(suggestion.probAfter).replace('10回中', '')}
        </span>
        <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          ({formatProbability(suggestion.probBefore)} → {formatProbability(suggestion.probAfter)}
          、約{formatEstimate(suggestion.savedYen, { approx: false })}少なくなる目安)
        </span>
      </p>
      <Link
        href={categoryHref(suggestion.categoryId, monthKey) as Route}
        className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold"
        style={{ color: 'var(--accent)' }}
      >
        {suggestion.categoryName}で試してみる
        <span aria-hidden>→</span>
      </Link>
    </section>
  );
}
