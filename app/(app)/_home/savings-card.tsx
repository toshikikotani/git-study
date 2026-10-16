import Link from 'next/link';

import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { formatEstimate, formatSignedEstimate } from '@/domain/forecast/format';
import { formatYen } from '@/domain/money';

export type SavingsCardProps = {
  /** 「10月31日まで」 */
  untilLabel: string;
  /** 月末に残る見込み(収入 − 支出の中央)。収入が無ければ null。 */
  balance: { p50: number; incomeYen: number } | null;
  /** 次の貯金目標。無ければ null。 */
  goal: { title: string; savedYen: number; targetYen: number | null } | null;
};

/** 万の単位を省いた「27.5万」(収入 − 支出の式の中で使う)。 */
function man(yen: number): string {
  return formatEstimate(yen, { approx: false }).replace('円', '');
}

/**
 * 貯金(デザイン仕様書の「今日」、ADR-090):月末に残る見込み(収入 − 支出)と、貯金目標の進み具合。
 * 目標が無ければ「目標をつくる」。
 */
export function SavingsCard({ untilLabel, balance, goal }: SavingsCardProps) {
  return (
    <section
      aria-labelledby="home-savings"
      className="flex flex-col rounded-[22px] p-5"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="home-savings" className="text-[17px] font-semibold">
          貯金
        </h2>
        <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          {untilLabel}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px]">月末に残る見込み</span>
          <span className="tabular text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            {balance
              ? `収入 ${man(balance.incomeYen)} − 支出 ${man(balance.incomeYen - balance.p50)}`
              : '収入を記録すると出せます'}
          </span>
        </span>
        {balance ? (
          <span
            className="tabular shrink-0 text-[28px] font-bold"
            style={{ color: balance.p50 >= 0 ? 'var(--income)' : 'var(--state-caution)' }}
          >
            {formatSignedEstimate(balance.p50)}
          </span>
        ) : null}
      </div>
      <div className="my-4 h-px" style={{ background: 'var(--hairline)' }} />
      {goal ? (
        <Link
          href="/savings"
          className="flex min-h-11 items-center gap-3"
          style={{ color: 'var(--ink)' }}
        >
          <TargetIcon />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-semibold">{goal.title}</span>
            <span className="tabular text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              {goal.targetYen !== null
                ? `${formatYen(goal.savedYen, { sign: 'never' })} / 目標 ${formatYen(goal.targetYen, { sign: 'never' })}`
                : `${formatYen(goal.savedYen, { sign: 'never' })} 貯まっています`}
            </span>
          </span>
          <span style={{ color: 'var(--ideal)' }}>
            <ChevronRightIcon />
          </span>
        </Link>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <TargetIcon />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[15px] font-semibold">目標はまだありません</span>
              <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                決めると、ここで進み具合を見られます
              </span>
            </span>
          </div>
          <Link
            href="/savings"
            className="mt-4 flex min-h-11 items-center justify-center rounded-full text-[15px] font-semibold"
            style={{ background: 'var(--action)', color: 'var(--on-action)' }}
          >
            目標をつくる
          </Link>
        </>
      )}
    </section>
  );
}

function TargetIcon() {
  return (
    <span
      aria-hidden
      className="flex size-11 shrink-0 items-center justify-center rounded-full"
      style={{ background: 'var(--income-track)', color: 'var(--income)' }}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="4.5" />
        <circle cx="12" cy="12" r="1" />
      </svg>
    </span>
  );
}
