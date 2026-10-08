import type { Route } from 'next';
import Link from 'next/link';

import { formatEstimate, formatEstimateRange, formatProbability } from '@/domain/forecast/format';
import type { ForecastSuggestion } from '@/domain/forecast/types';
import { categoryHref } from '@/lib/category-nav';

/**
 * 月末の見込みの見出し(デザインの「見通し」の「月末の支出」、ADR-085):中央を1つ大きく、
 * 予算との差を右上のバッジに、80%の幅と予算に収まる確率をその下に。予算の書き方は「17.0万円」に
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
  const gap = budgetYen === null ? null : landing.p50 - budgetYen;
  return (
    <section
      aria-label={`${endLabel}の支出の見込み`}
      className="flex flex-col gap-2 rounded-[22px] p-5"
      style={{ background: 'var(--surface)' }}
    >
      <h2
        className="text-[17px] leading-snug font-semibold tracking-[-0.02em]"
        style={{ color: 'var(--ink)' }}
      >
        {gap === null
          ? `${endLabel}の支出`
          : gap > 0
            ? `予算を${formatEstimate(gap)}超えそうです。`
            : `予算まで${formatEstimate(-gap)}の余裕です。`}
        {provisional ? (
          <span
            className="ml-2 align-middle text-xs font-semibold"
            style={{ color: 'var(--ink-secondary)' }}
          >
            目安
          </span>
        ) : null}
      </h2>
      <p
        className="tabular text-[40px] leading-none font-bold tracking-[-0.04em]"
        style={{ color: 'var(--ink)' }}
      >
        {formatEstimate(landing.p50)}
        {budgetYen !== null ? (
          <span className="ml-2 text-[17px] font-normal" style={{ color: 'var(--ink-secondary)' }}>
            / 予算 {formatEstimate(budgetYen, { approx: false })}
          </span>
        ) : null}
      </p>
      <p className="tabular text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
        80%の確率で {formatEstimateRange(landing.p10, landing.p90)}
        {probWithinBudget !== null ? (
          <>
            {' '}
            ・ 予算に収まる確率{' '}
            <span className="font-semibold" style={{ color: 'var(--ink)' }}>
              {formatProbability(probWithinBudget)}
            </span>
          </>
        ) : null}
      </p>
    </section>
  );
}

/**
 * 次の一手(デザインの「次の一手」、ADR-085):提案のジャンルを週に何回へらすと、月末の支出が
 * どれだけ少なくなるか。押すとそのジャンルの見通し(「もし」)へ。
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
      className="flex flex-col gap-2 rounded-[22px] p-5"
      style={{ background: 'var(--surface)' }}
    >
      <h2 className="text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>
        次の一手
      </h2>
      <p
        className="text-[22px] leading-snug font-bold tracking-[-0.02em]"
        style={{ color: 'var(--ink)' }}
      >
        {suggestion.categoryName}を週{suggestion.perWeek}回へらすと
      </p>
      <p className="tabular text-base leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        月末の支出が{' '}
        <strong style={{ color: 'var(--ink)' }}>{formatEstimate(suggestion.savedYen)}</strong>{' '}
        少なくなる見込みです。
        <span className="block text-xs" style={{ color: 'var(--ink-muted)' }}>
          予算に収まる確率 {formatProbability(suggestion.probBefore)} →{' '}
          {formatProbability(suggestion.probAfter)}
        </span>
      </p>
      <Link
        href={categoryHref(suggestion.categoryId, monthKey) as Route}
        className="mt-2 inline-flex min-h-11 items-center self-start rounded-full px-4 text-[15px] font-semibold"
        style={{ background: 'var(--action)', color: 'var(--on-action)' }}
      >
        {suggestion.categoryName}の見通しを見る
      </Link>
    </section>
  );
}
