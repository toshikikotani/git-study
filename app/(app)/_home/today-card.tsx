import Link from 'next/link';

import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { formatEstimate, formatProbability } from '@/domain/forecast/format';
import type { TodayAllowance } from '@/domain/forecast/today';
import type { ForecastSuggestion } from '@/domain/forecast/types';
import { NextStepCard } from '../reports/next-step-card';
import { AllowanceDialog, type AllowanceExplain } from './allowance-dialog';

/** 今期(目標の期間)の見通し。数字は「見通し」の画面と同じ予測。 */
export type TodayOutlook = {
  /** 「10/1〜11/5 · 残り21日」 */
  periodLabel: string;
  /** これまでに使った額(事実)。 */
  spentYen: number;
  p10: number;
  p50: number;
  p90: number;
  budgetYen: number;
};

export type TodayCardProps = {
  /** 目標が無ければ null(今日使える目安は出せない)。 */
  today: TodayAllowance | null;
  outlook: TodayOutlook | null;
  suggestion: ForecastSuggestion | null;
  /** 予算内に収まる確率(目標の範囲)。 */
  probWithinBudget: number | null;
  provisional: boolean;
  /** 今日の目安の内訳(「なぜこの額？」)。 */
  allowanceExplain?: AllowanceExplain | null;
  /** 「2026-10」(次の一手からカテゴリの画面へ) */
  monthKey?: string;
};

const card = 'flex flex-col rounded-[22px]';
const cardStyle = { background: 'var(--surface)', color: 'var(--ink)' } as const;

/**
 * ホームの「今日」(デザイン仕様書、ADR-090):今日使える目安 → 今期の見通し(押すと見通しへ)→ 次の一手。
 */
export function TodayCard(props: TodayCardProps) {
  const { today, outlook, suggestion, probWithinBudget } = props;
  return (
    <>
      <TodayHero
        today={today}
        provisional={props.provisional}
        allowanceExplain={props.allowanceExplain ?? null}
      />
      {outlook && probWithinBudget !== null ? (
        <OutlookCard outlook={outlook} probWithin={probWithinBudget} />
      ) : null}
      {suggestion ? <NextStepCard suggestion={suggestion} /> : null}
    </>
  );
}

/** 今日の目安が、いつもの1日(平日・休日の別)の何%か。 */
function usualPercent(explain: AllowanceExplain | null): number | null {
  const limit = explain?.dailyLimit;
  if (!explain || !limit) return null;
  const usual = limit.todayIsDayOff ? explain.dayOffPerDayYen : explain.weekdayPerDayYen;
  if (usual && usual > 0) return Math.round((limit.todayLimitYen / usual) * 100);
  return Math.round(limit.safetyFactor * 100);
}

function TodayHero({
  today,
  provisional,
  allowanceExplain,
}: {
  today: TodayAllowance | null;
  provisional: boolean;
  allowanceExplain: AllowanceExplain | null;
}) {
  if (!today) {
    return (
      <section
        aria-label="今日使える目安"
        className={`${card} gap-2 px-5 pt-6 pb-2`}
        style={cardStyle}
      >
        <span className="text-[15px] font-medium" style={{ color: 'var(--ink-muted)' }}>
          今日使える目安
        </span>
        <p className="text-[15px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          目標(カテゴリごとの予算)を決めると、今日使える目安を出せます。
        </p>
        <div className="mt-2 h-px" style={{ background: 'var(--hairline)' }} />
        <Link
          href="/reports"
          className="flex min-h-12 items-center justify-between text-[15px] font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          目標を決める
          <ChevronRightIcon />
        </Link>
      </section>
    );
  }
  const left = today.kind === 'left';
  const pct = usualPercent(allowanceExplain);
  return (
    <section aria-label="今日使える目安" className={`${card} px-5 pt-6 pb-2`} style={cardStyle}>
      <span className="text-[15px] font-medium" style={{ color: 'var(--ink-muted)' }}>
        {left ? '今日使える目安' : '今日は目安を'}
        {provisional ? '(記録が少ないので仮)' : ''}
      </span>
      <p
        className="tabular mt-1 flex items-baseline gap-1"
        style={{ color: left ? 'var(--ink)' : 'var(--state-caution)' }}
      >
        {/* 68px は大きすぎた(本人の指摘「8950がちょっとでかい」)。56px にした。 */}
        <span className="text-[56px] leading-none font-bold tracking-[-0.02em]">
          {(left ? today.leftYen : today.overYen).toLocaleString('ja-JP')}
        </span>
        <span className="text-[24px] font-semibold">{left ? '円' : '円 超え'}</span>
      </p>
      <p className="mt-2 text-[15px] leading-normal" style={{ color: 'var(--ink-secondary)' }}>
        {pct !== null ? `いつもの1日の約${pct}%。` : ''}
        使わなかった分は明日に回ります。
      </p>
      <div className="mt-4 h-px" style={{ background: 'var(--hairline)' }} />
      {allowanceExplain ? (
        <AllowanceDialog explain={allowanceExplain} />
      ) : (
        <div className="min-h-2" />
      )}
    </section>
  );
}

/** 2026-10-01 → 10/1 */
export function shortDate(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/**
 * 今期の見通し(デザイン仕様書):見込み(中央)と予算、1本の帯(使った額・予算を超える側・予算の目盛り・
 * 見込みの印)、使った額と予算内に収まる確率。押すと「分析 › 目標」へ(ADR-091)。
 */
function OutlookCard({ outlook, probWithin }: { outlook: TodayOutlook; probWithin: number }) {
  const overYen = outlook.p50 - outlook.budgetYen;
  const max = Math.max(outlook.p90, outlook.budgetYen, outlook.spentYen, outlook.p50, 1);
  const pct = (yen: number) => Math.min(100, Math.max(0, (yen / max) * 100));
  const caution = probWithin < 0.5;
  return (
    <Link
      href="/reports"
      aria-label={`今期の見通し。${formatEstimate(outlook.p50)}、予算 ${formatEstimate(outlook.budgetYen, { approx: false })}。詳しい見通しへ`}
      className={`${card} min-h-11 px-5 pt-5 pb-2`}
      style={cardStyle}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex flex-col">
          <span className="text-[17px] font-semibold">今期の見通し</span>
          <span className="tabular text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            {outlook.periodLabel}
          </span>
        </span>
        <span
          className="shrink-0 rounded-full px-3 py-1 text-[13px] font-semibold whitespace-nowrap"
          style={
            overYen > 0
              ? { background: 'var(--state-caution-track)', color: 'var(--state-caution)' }
              : { background: 'var(--income-track)', color: 'var(--income)' }
          }
        >
          {overYen > 0 ? `${formatEstimate(overYen)} 超えそう` : '予算内の見込み'}
        </span>
      </div>
      <p className="tabular mt-4 flex flex-wrap items-baseline gap-2">
        <span className="text-[34px] leading-tight font-bold tracking-[-0.01em]">
          {formatEstimate(outlook.p50)}
        </span>
        <span className="text-[15px]" style={{ color: 'var(--ink-muted)' }}>
          / 予算 {formatEstimate(outlook.budgetYen, { approx: false })}
        </span>
      </p>
      <div aria-hidden className="relative mt-4 h-7">
        <span
          className="absolute inset-x-0 top-2 h-3 rounded-full"
          style={{ background: 'var(--track)' }}
        />
        <span
          className="absolute top-2 right-0 h-3 rounded-r-full"
          style={{ left: `${pct(outlook.budgetYen)}%`, background: 'var(--caution-zone)' }}
        />
        <span
          className="absolute top-2 left-0 h-3 rounded-full"
          style={{ width: `${pct(outlook.spentYen)}%`, background: 'var(--accent)' }}
        />
        <span
          className="absolute top-0 h-6 w-0.5 rounded-sm"
          style={{ left: `${pct(outlook.budgetYen)}%`, background: 'var(--ink)' }}
        />
        <span
          className="absolute top-1 size-4 -translate-x-1/2 rounded-full"
          style={{
            left: `${pct(outlook.p50)}%`,
            background: 'var(--surface)',
            border: '3px solid var(--caution-mark)',
          }}
        />
      </div>
      <div
        className="tabular mt-1 flex justify-between gap-2 text-[13px]"
        style={{ color: 'var(--ink-muted)' }}
      >
        <span>
          使った額{' '}
          <strong className="font-semibold" style={{ color: 'var(--ink)' }}>
            {formatEstimate(outlook.spentYen, { approx: false })}
          </strong>
        </span>
        <span>
          予算内に収まる確率{' '}
          <strong
            className="font-semibold"
            style={{ color: caution ? 'var(--state-caution)' : 'var(--income)' }}
          >
            {formatProbability(probWithin)}
          </strong>
        </span>
      </div>
      <div className="mt-4 h-px" style={{ background: 'var(--hairline)' }} />
      <span
        className="flex min-h-12 items-center justify-between text-[15px] font-semibold"
        style={{ color: 'var(--accent)' }}
      >
        詳しい見通し
        <ChevronRightIcon />
      </span>
    </Link>
  );
}
