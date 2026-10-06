import Link from 'next/link';

import {
  formatEstimate,
  formatEstimateRange,
  formatProbability,
  formatSignedEstimate,
  formatTimesInTen,
} from '@/domain/forecast/format';
import { todaySentence, type TodayAllowance } from '@/domain/forecast/today';
import type { ForecastSuggestion } from '@/domain/forecast/types';
import { formatYen } from '@/domain/money';
import { SpeakButton } from './speak-button';

export type TodayCardProps = {
  /** 目標が無ければ null(今日あと使える額は出せない)。 */
  today: TodayAllowance | null;
  /** 月末の収支の見込み(今月のすべての支出。収入が無ければ null)。 */
  balance: { p10: number; p50: number; p90: number } | null;
  suggestion: ForecastSuggestion | null;
  /** 予算に収まる確率(目標の範囲)。 */
  probWithinBudget: number | null;
  provisional: boolean;
};

/**
 * ホームの先頭(設計書 v3 3.1):今日あと使える額 → 月末の収支の見込み → 提案を1つ →
 * 予算に収まる確率。数字は 1 つだけ大きく出す。
 */
export function TodayCard(props: TodayCardProps) {
  const { today, balance, suggestion, probWithinBudget } = props;
  const est = (yen: number) => formatEstimate(yen, { approx: false });
  const spoken = [
    today ? todaySentence(today, est) : null,
    balance ? `月末の収支の見込みは${formatSignedEstimate(balance.p50)}。` : null,
    probWithinBudget !== null ? `予算に収まるのは${formatTimesInTen(probWithinBudget)}。` : null,
  ]
    .filter(Boolean)
    .join('');
  return (
    <section
      aria-label="今日あと使える額"
      className="rise relative overflow-hidden rounded-[28px] p-6 pb-7"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-28 -right-20 size-64 rounded-full blur-3xl"
        style={{ background: 'var(--hero-glow)' }}
      />
      <div className="relative">
        {today ? (
          <>
            <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
              {today.kind === 'left' ? '今日 あと' : '今日は上限を'}
              {props.provisional ? ' ・ 目安' : ''}
            </p>
            <p
              className="tabular mt-3 text-4xl leading-none font-semibold tracking-[-0.045em]"
              style={{ color: today.kind === 'left' ? 'var(--ink)' : 'var(--state-caution)' }}
            >
              {today.kind === 'left' ? est(today.leftYen) : `${est(today.overYen)} 超え`}
            </p>
            <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              1日の上限 {est(today.capYen)}(予算に収まるのが10回中8回になる額)から、今日の{' '}
              {formatYen(today.spentYen, { sign: 'never' })}{' '}
              を引いた額。使わなかった分は、明日からの上限に戻る。
            </p>
          </>
        ) : (
          <>
            <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
              今日 あと
            </p>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
              目標(ジャンルごとの予算)を決めると、今日あと使える額を出せます。
            </p>
            <Link
              href="/plan"
              className="mt-2 inline-flex min-h-11 items-center gap-1 text-xs font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              目標を決める
              <span aria-hidden>→</span>
            </Link>
          </>
        )}

        <dl className="mt-4 space-y-2 text-sm">
          {balance ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt style={{ color: 'var(--ink-secondary)' }}>月末の収支の見込み</dt>
              <dd className="tabular text-right" style={{ color: 'var(--ink)' }}>
                <span className="font-semibold">{formatSignedEstimate(balance.p50)}</span>
                <span className="block text-xs" style={{ color: 'var(--ink-muted)' }}>
                  10回中8回 {formatEstimateRange(balance.p10, balance.p90)}
                </span>
              </dd>
            </div>
          ) : null}
          {probWithinBudget !== null ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt style={{ color: 'var(--ink-secondary)' }}>予算に収まる見込み</dt>
              <dd className="tabular text-right" style={{ color: 'var(--ink)' }}>
                {formatTimesInTen(probWithinBudget)}
                <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  ({formatProbability(probWithinBudget)})
                </span>
              </dd>
            </div>
          ) : null}
        </dl>
        {suggestion && suggestion.probAfter - suggestion.probBefore >= 0.01 ? (
          <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
            {suggestion.categoryName}を週1回減らすと、収まる確率{' '}
            {formatProbability(suggestion.probBefore)} → {formatProbability(suggestion.probAfter)}
          </p>
        ) : null}
        <div className="mt-3 flex items-center justify-between gap-2">
          <Link
            href="/reports"
            className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            なぜこの見込み?
            <span aria-hidden>→</span>
          </Link>
          {spoken ? <SpeakButton text={spoken} /> : null}
        </div>
      </div>
    </section>
  );
}
