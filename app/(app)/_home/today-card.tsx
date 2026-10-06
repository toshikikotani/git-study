import Link from 'next/link';

import { TenDots } from '@/components/ui/ten-dots';
import {
  estimateParts,
  formatEstimate,
  formatProbability,
  formatSignedEstimate,
  formatTimesInTen,
} from '@/domain/forecast/format';
import { todaySentence, type TodayAllowance } from '@/domain/forecast/today';
import type { ForecastSuggestion } from '@/domain/forecast/types';
import { formatYen } from '@/domain/money';
import { NextStepCard } from '../reports/landing-hero';
import { SpeakButton } from './speak-button';

/** 今日あと使える額が「予算に収まるのが10回中8回になる額」から出ていること(dots の数)。 */
const SAFE_ALLOWANCE_PROB = 0.8;

export type TodayCardProps = {
  /** 目標が無ければ null(今日あと使える額は出せない)。 */
  today: TodayAllowance | null;
  /** 月末の収支の見込み(今月のすべての支出。収入が無ければ null)。 */
  balance: { p10: number; p50: number; p90: number; incomeYen?: number } | null;
  suggestion: ForecastSuggestion | null;
  /** 予算に収まる確率(目標の範囲)。 */
  probWithinBudget: number | null;
  provisional: boolean;
  /** 「10月6日(火) · 10月は残り26日」 */
  dateLine?: string;
  /** 目標の予算と、その範囲の月末の見込み(中央)・超えるときの平均の超過額。 */
  budget?: { yen: number; landingP50: number; expectedOvershoot: number } | null;
  /** 「2026-10」(次の一手からジャンル画面へ) */
  monthKey?: string;
};

/**
 * ホームの先頭(デザインのホーム・設計書 v3 3.1):今日あと使える額(大きな数字は1つだけ)→
 * 月末の収支の見込み → 予算に収まる回数 → 次の一手。
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
    <div className="space-y-3">
      {props.dateLine ? (
        <header className="px-1">
          <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            {props.dateLine}
          </p>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)' }}>
            今日の家計
          </h1>
        </header>
      ) : null}

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
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold" style={{ color: 'var(--ink-secondary)' }}>
                  {today.kind === 'left' ? '今日 あと使える' : '今日は上限を'}
                </p>
                {props.provisional ? (
                  <span
                    className="rounded-full px-3 py-1 text-xs font-semibold"
                    style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
                  >
                    目安
                  </span>
                ) : null}
              </div>
              <p
                className="tabular mt-3 text-4xl leading-none font-semibold tracking-[-0.045em]"
                style={{ color: today.kind === 'left' ? 'var(--ink)' : 'var(--state-caution)' }}
              >
                {today.kind === 'left' ? est(today.leftYen) : `${est(today.overYen)} 超え`}
              </p>
              <div
                className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-3"
                style={{ borderTop: '1px solid var(--hairline)' }}
              >
                <p className="text-sm" style={{ color: 'var(--ink)' }}>
                  毎日この額までなら、月末に予算に収まる
                </p>
                <span className="flex items-center gap-2">
                  <TenDots probability={SAFE_ALLOWANCE_PROB} size="sm" />
                  <span className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                    10回中8回
                  </span>
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
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
          <div className="mt-2 flex items-center justify-between gap-2">
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

      {balance ? <BalanceCard balance={balance} /> : null}

      {probWithinBudget !== null ? (
        <section
          aria-label="予算に収まる見込み"
          className="space-y-3 rounded-[24px] p-5"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
              {props.budget
                ? `予算 ${formatEstimate(props.budget.yen, { approx: false })}に収まる`
                : '予算に収まる見込み'}
            </h2>
            <p className="tabular text-sm" style={{ color: 'var(--ink-secondary)' }}>
              <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                {formatTimesInTen(probWithinBudget)}
              </span>
              <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                ({formatProbability(probWithinBudget)})
              </span>
            </p>
          </div>
          <TenDots probability={probWithinBudget} />
          {props.budget ? (
            <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              このままだと月末は{formatEstimate(props.budget.landingP50)}。
              {props.budget.expectedOvershoot > 0
                ? `超えるときは、平均で${formatEstimate(props.budget.expectedOvershoot)}超える。`
                : ''}
            </p>
          ) : null}
        </section>
      ) : null}

      {suggestion && props.monthKey ? (
        <NextStepCard suggestion={suggestion} monthKey={props.monthKey} />
      ) : null}
    </div>
  );
}

/** 月末の収支の見込み(デザインのホーム):中央を大きく、10回中8回の幅を帯で、収入 − 支出の見込み。 */
function BalanceCard({ balance }: { balance: NonNullable<TodayCardProps['balance']> }) {
  const sign = balance.p50 < 0 ? '−' : '+';
  const parts = estimateParts(Math.abs(balance.p50));
  // 帯の位置:0円(収支がちょうど0)を含む範囲で、10回中8回の幅を置く。
  const lo = Math.min(0, balance.p10);
  const hi = Math.max(0, balance.p90);
  const span = Math.max(1, hi - lo);
  const pct = (v: number) => `${((v - lo) / span) * 100}%`;
  return (
    <section
      aria-label="月末の収支の見込み"
      className="space-y-3 rounded-[24px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-secondary)' }}>
        月末の収支の見込み
      </h2>
      <p className="tabular flex items-baseline gap-1" style={{ color: 'var(--ink)' }}>
        <span className="text-3xl leading-none font-semibold tracking-[-0.03em]">
          {sign}
          {parts.number}
        </span>
        <span className="text-base font-semibold">{parts.unit}</span>
      </p>
      <div>
        <div aria-hidden className="relative h-3">
          <div
            className="absolute inset-x-0 top-1 h-1 rounded-full"
            style={{ background: 'var(--plane)' }}
          />
          <div
            className="absolute top-0 h-3 rounded-full"
            style={{
              left: pct(balance.p10),
              width: `calc(${pct(balance.p90)} - ${pct(balance.p10)})`,
              background: balance.p50 < 0 ? 'var(--state-caution-track)' : 'var(--state-ok-track)',
            }}
          />
          <div
            className="absolute top-0 size-3 -translate-x-1/2 rounded-full"
            style={{
              left: pct(balance.p50),
              background: balance.p50 < 0 ? 'var(--state-caution)' : 'var(--state-ok)',
              boxShadow: '0 0 0 2px var(--surface)',
            }}
          />
        </div>
        <div
          className="tabular mt-1 flex justify-between text-xs"
          style={{ color: 'var(--ink-secondary)' }}
        >
          <span>{formatSignedEstimate(balance.p10).replace('円', '')}</span>
          <span>{formatSignedEstimate(balance.p90).replace('円', '')}</span>
        </div>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          10回中8回は、この幅に入る
        </p>
      </div>
      {balance.incomeYen !== undefined ? (
        <p
          className="tabular pt-3 text-xs"
          style={{ color: 'var(--ink-secondary)', borderTop: '1px solid var(--hairline)' }}
        >
          収入 {formatEstimate(balance.incomeYen, { approx: false }).replace('円', '')} −
          支出の見込み{' '}
          {formatEstimate(balance.incomeYen - balance.p50, { approx: false }).replace('円', '')}
        </p>
      ) : null}
    </section>
  );
}
