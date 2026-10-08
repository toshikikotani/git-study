import Link from 'next/link';

import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { TenDots } from '@/components/ui/ten-dots';
import { formatEstimate, formatProbability } from '@/domain/forecast/format';
import type { TodayAllowance } from '@/domain/forecast/today';
import type { ForecastSuggestion } from '@/domain/forecast/types';
import { NextStepCard } from '../reports/landing-hero';

/** 今日あと使える額は「予算に収まるのが80%になる額」から出している(点の数)。 */
const SAFE_ALLOWANCE_PROB = 0.8;

/** 目標の期間の見通し(見込みの幅・予算・使った額)。 */
export type TodayOutlook = {
  /** 「10月の見通し」「10月14日までの見通し」 */
  label: string;
  /** これまでに使った額(事実)。 */
  spentYen: number;
  p10: number;
  p50: number;
  p90: number;
  budgetYen: number;
  /** 目標に入っていないジャンル(すべての支出の着地)。 */
  outside?: { name: string; p50: number }[];
};

export type TodayCardProps = {
  /** 目標が無ければ null(今日あと使える額は出せない)。 */
  today: TodayAllowance | null;
  outlook: TodayOutlook | null;
  suggestion: ForecastSuggestion | null;
  /** 予算に収まる確率(目標の範囲)。 */
  probWithinBudget: number | null;
  provisional: boolean;
  /** 「2026-10」(次の一手からジャンル画面へ) */
  monthKey?: string;
};

/**
 * ホームの先頭(デザインの「今日」、ADR-085):今日使える額(大きな数字は1つだけ)→
 * 見通し(月末の見込みと予算)→ 次の一手。
 */
export function TodayCard(props: TodayCardProps) {
  const { today, outlook, suggestion, probWithinBudget } = props;
  return (
    <div className="space-y-3">
      <TodayHero today={today} provisional={props.provisional} />
      {outlook && probWithinBudget !== null ? (
        <OutlookCard outlook={outlook} probOver={1 - probWithinBudget} />
      ) : null}
      {suggestion && props.monthKey ? (
        <NextStepCard suggestion={suggestion} monthKey={props.monthKey} />
      ) : null}
    </div>
  );
}

function TodayHero({ today, provisional }: { today: TodayAllowance | null; provisional: boolean }) {
  return (
    <section
      aria-label="今日使える額"
      className="glass rise flex flex-col gap-1 rounded-[28px] px-6 pt-6 pb-5"
      style={{
        background: 'var(--surface)',
        border: '1px solid color-mix(in srgb, var(--accent) 32%, transparent)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      {today ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-base font-medium" style={{ color: 'var(--ink-secondary)' }}>
              {today.kind === 'left' ? '今日 使えるのは' : '今日は上限を'}
            </p>
            {provisional ? (
              <span
                className="rounded-full px-3 py-1 text-xs font-semibold"
                style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
              >
                目安
              </span>
            ) : null}
          </div>
          <p
            className="tabular mt-1 flex items-baseline gap-1"
            style={{ color: today.kind === 'left' ? 'var(--ink)' : 'var(--state-caution)' }}
          >
            <span className="text-4xl leading-none font-bold tracking-[-0.04em]">
              {(today.kind === 'left' ? today.leftYen : today.overYen).toLocaleString('ja-JP')}
            </span>
            <span className="text-base font-bold">{today.kind === 'left' ? '円' : '円 超え'}</span>
          </p>
          <div className="my-4 h-px" style={{ background: 'var(--hairline)' }} />
          <TenDots probability={SAFE_ALLOWANCE_PROB} />
          <p className="mt-2 text-base leading-relaxed" style={{ color: 'var(--ink)' }}>
            毎日この額までなら、
            <strong style={{ color: 'var(--ink)' }}>
              {formatProbability(SAFE_ALLOWANCE_PROB)}の確率
            </strong>
            で予算内に収まります。
          </p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            使わなかった分は、明日に回ります。
          </p>
        </>
      ) : (
        <>
          <p className="text-base font-medium" style={{ color: 'var(--ink-secondary)' }}>
            今日 使えるのは
          </p>
          <p className="mt-2 text-base leading-relaxed" style={{ color: 'var(--ink)' }}>
            目標(ジャンルごとの予算)を決めると、今日使える額を出せます。
          </p>
          <Link
            href="/plan"
            className="mt-2 inline-flex min-h-11 items-center gap-1 text-base font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            目標を決める
            <ChevronRightIcon />
          </Link>
        </>
      )}
      {today ? (
        <Link
          href="/reports"
          className="mt-2 inline-flex min-h-11 items-center gap-1 text-base font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          なぜこの額?
          <ChevronRightIcon />
        </Link>
      ) : null}
    </section>
  );
}

/**
 * 見通しのカード(デザイン):月末の見込み(中央)と予算、使った額・10回中8回の幅・中央の点・予算の線を
 * 1本の帯に、その下に予算を超える確率。
 */
function OutlookCard({ outlook, probOver }: { outlook: TodayOutlook; probOver: number }) {
  const overYen = outlook.p50 - outlook.budgetYen;
  const max = Math.max(outlook.p90, outlook.budgetYen, outlook.spentYen, 1) * 1.02;
  const pct = (yen: number) => `${Math.min(100, Math.max(0, (yen / max) * 100))}%`;
  const caution = probOver >= 0.5;
  return (
    <section
      aria-label={outlook.label}
      className="glass flex flex-col gap-3 rounded-[28px] p-6"
      style={{
        background: 'var(--surface)',
        border: '1px solid color-mix(in srgb, var(--accent) 32%, transparent)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-medium" style={{ color: 'var(--ink-secondary)' }}>
          {outlook.label}
        </h2>
        <span
          className="rounded-full px-3 py-1 text-sm font-semibold"
          style={
            overYen > 0
              ? { background: 'var(--state-caution-track)', color: 'var(--state-caution)' }
              : { background: 'var(--state-ok-track)', color: 'var(--state-ok)' }
          }
        >
          {overYen > 0 ? `${formatEstimate(overYen)} 超えそう` : '予算内の見込み'}
        </span>
      </div>
      <p className="tabular flex flex-wrap items-baseline gap-2">
        <span className="text-3xl font-bold tracking-[-0.02em]" style={{ color: 'var(--ink)' }}>
          {formatEstimate(outlook.p50)}
        </span>
        <span className="text-base" style={{ color: 'var(--ink-secondary)' }}>
          / 予算 {formatEstimate(outlook.budgetYen, { approx: false })}
        </span>
      </p>
      {outlook.outside && outlook.outside.length > 0 ? (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          目標に入っていない:{' '}
          {outlook.outside
            .map((c) => `${c.name} ${formatEstimate(c.p50, { approx: false })}`)
            .join('、')}
        </p>
      ) : null}
      <div aria-hidden className="relative h-10">
        <div
          className="absolute inset-x-0 top-[18px] h-2.5 rounded-full"
          style={{ background: 'var(--plane)' }}
        />
        <div
          className="absolute top-[18px] left-0 h-2.5 rounded-full"
          style={{ width: pct(outlook.spentYen), background: 'var(--accent)' }}
        />
        <div
          className="absolute top-[18px] h-2.5 rounded-full"
          style={{
            left: pct(outlook.p10),
            width: `calc(${pct(outlook.p90)} - ${pct(outlook.p10)})`,
            background: 'transparent',
            border: '1.5px solid var(--mark, var(--accent))',
            boxSizing: 'border-box',
          }}
        />
        <div
          className="absolute top-[15px] size-4 -translate-x-1/2 rounded-full"
          style={{
            left: pct(outlook.p50),
            background: 'var(--mark, var(--accent))',
            boxShadow: '0 0 0 3px var(--surface)',
          }}
        />
        <div
          className="absolute top-2.5 h-6 w-0.5 -translate-x-1/2"
          style={{ left: pct(outlook.budgetYen), background: 'var(--ink)' }}
        />
        <span
          className="absolute -top-1.5 -translate-x-1/2 text-xs font-semibold"
          style={{ left: pct(outlook.budgetYen), color: 'var(--ink)' }}
        >
          予算
        </span>
      </div>
      <div
        className="tabular -mt-1 flex justify-between gap-2 text-xs"
        style={{ color: 'var(--ink-secondary)' }}
      >
        <span>使った額 {formatEstimate(outlook.spentYen, { approx: false })}</span>
        <span>
          80%の確率で {formatEstimate(outlook.p10, { approx: false }).replace('円', '')}〜
          {formatEstimate(outlook.p90, { approx: false })}
        </span>
      </div>
      <div className="h-px" style={{ background: 'var(--hairline)' }} />
      <div className="flex flex-col gap-2">
        <p className="text-base" style={{ color: 'var(--ink)' }}>
          <strong style={{ color: caution ? 'var(--state-caution)' : 'var(--ink)' }}>
            {formatProbability(probOver)}
          </strong>
          の確率で 予算を超えます
        </p>
        <div aria-hidden className="h-1.5 rounded-full" style={{ background: 'var(--plane)' }}>
          <div
            className="h-1.5 rounded-full"
            style={{
              width: `${Math.round(Math.min(1, Math.max(0, probOver)) * 100)}%`,
              background: caution ? 'var(--sub, var(--accent))' : 'var(--ink)',
            }}
          />
        </div>
      </div>
    </section>
  );
}
