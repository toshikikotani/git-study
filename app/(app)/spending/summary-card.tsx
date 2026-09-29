'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { formatSignedYen } from '@/domain/budget-state';
import { formatYen } from '@/domain/money';
import { Yen } from '@/components/ui/money';
import type { PaceComparison } from '@/domain/summary-rules';
import { splitDateOnly } from '@/lib/date';
import { useSpendingMonth } from './spending-month-provider';

export type ForecastInfo = {
  /** 出してよいとき(記録が7日以上)だけ値が入る。 */
  projectedTotalYen: number | null;
  totalBudgetYen: number | null;
};

/**
 * サマリー(今月使った額と前月同日比)。
 *
 * 記録が少ないときに意味のない数字を出さない(domain/summary-rules.ts):
 *   - 前月のデータが無ければ比較は出さず「記録開始からN日」
 *   - 収入が未登録なら「0円」や差額は出さず、「収入を登録」への導線にする
 *   - 記録が7日未満なら「このペースが続くと」の予測は出さない
 * 差額のマイナスは「−」(U+2212)、赤は使わない(赤は予算超過とエラーだけ)。
 *
 * 目標期間中は、この上に目標のスライド(goal)を並べ、横スワイプで月表示に切り替える。
 */
export function SummaryCard({
  pace,
  forecast,
  hasIncomeRegistered,
  goal,
}: {
  pace: PaceComparison;
  forecast: ForecastInfo;
  hasIncomeRegistered: boolean;
  /** 目標期間中のサマリー(期間・残り日数・使った額/予算・今日使える額)。 */
  goal: ReactNode | null;
}) {
  const monthPane = (
    <MonthPane pace={pace} forecast={forecast} hasIncomeRegistered={hasIncomeRegistered} />
  );
  if (goal === null) return monthPane;

  return (
    <div>
      <div
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2"
        style={{ scrollbarWidth: 'none' }}
        role="region"
        aria-label="サマリー(横にスワイプで目標と月を切り替え)"
        tabIndex={0}
      >
        <div className="w-full shrink-0 snap-center">{goal}</div>
        <div className="w-full shrink-0 snap-center">{monthPane}</div>
      </div>
      <p className="text-center text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        ← 目標期間 ・ 月 →(スワイプで切り替え)
      </p>
    </div>
  );
}

function MonthPane({
  pace,
  forecast,
  hasIncomeRegistered,
}: {
  pace: PaceComparison;
  forecast: ForecastInfo;
  hasIncomeRegistered: boolean;
}) {
  const { totals, isCurrentMonth, visibleMonth, loading, error } = useSpendingMonth();
  const [year, month] = splitDateOnly(visibleMonth);
  // 別の月を取りに行っているあいだは、0円ではなく読み込み中と分かるようにする。
  const waiting = !isCurrentMonth && (loading || error !== null);
  const incomeRegistered = isCurrentMonth ? hasIncomeRegistered : totals.incomeYen > 0;
  const netYen = totals.incomeYen - totals.spentYen;

  return (
    <section
      aria-label="使った額のサマリー"
      className="rounded-3xl p-6"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
        {isCurrentMonth ? '今月使った額' : `${year}年${month}月に使った額`}
      </p>
      {waiting && error === null ? (
        <div
          role="status"
          aria-label="読み込み中"
          className="mt-2 h-10 w-44 animate-pulse rounded-lg"
          style={{ background: 'var(--hairline)' }}
        />
      ) : (
        <p
          className="tabular mt-1 text-4xl leading-none font-semibold tracking-tight"
          style={{ color: waiting ? 'var(--ink-muted)' : 'var(--ink)' }}
        >
          {waiting ? '—' : <Yen value={totals.spentYen} />}
        </p>
      )}
      {waiting && error !== null ? (
        <p role="alert" className="mt-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {error}
        </p>
      ) : null}

      {!waiting && (totals.specialYen > 0 || totals.scheduledYen > 0) ? (
        <p className="tabular mt-2 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          {totals.specialYen > 0 ? `うち特別費 ${formatYen(totals.specialYen)}` : ''}
          {totals.specialYen > 0 && totals.scheduledYen > 0 ? ' ・ ' : ''}
          {totals.scheduledYen > 0 ? `このほか予定 ${formatYen(totals.scheduledYen)}` : ''}
        </p>
      ) : null}

      {!waiting ? (
        <dl
          className="mt-4 grid grid-cols-2 gap-3 border-t pt-4"
          style={{ borderColor: 'var(--hairline)' }}
        >
          {incomeRegistered ? (
            <>
              <div>
                <dt className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                  収入
                </dt>
                <dd className="tabular text-sm font-semibold" style={{ color: 'var(--income)' }}>
                  {formatYen(totals.incomeYen, { sign: 'never' })}
                </dd>
              </div>
              <div>
                <dt className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                  差額
                </dt>
                <dd className="tabular text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                  {formatSignedYen(netYen)}
                </dd>
              </div>
            </>
          ) : (
            <div className="col-span-2">
              <Link
                href="/transactions/new?type=income"
                prefetch={false}
                className="text-sm font-semibold"
                style={{ color: 'var(--accent)' }}
              >
                収入を登録 →
              </Link>
              <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                登録すると、収入との差額が見られます
              </p>
            </div>
          )}
        </dl>
      ) : null}

      {isCurrentMonth ? <PaceLine pace={pace} /> : null}
      {isCurrentMonth && forecast.projectedTotalYen !== null ? (
        <ForecastLine forecast={forecast} />
      ) : null}
    </section>
  );
}

function PaceLine({ pace }: { pace: PaceComparison }) {
  if (pace.kind === 'none') return null;
  if (pace.kind === 'since_start') {
    return (
      <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        記録開始から{pace.days}日。先月のデータがそろうと、同じ日との比較が出ます。
      </p>
    );
  }
  const isLess = pace.diffYen < 0;
  return (
    <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
      先月の{pace.dayOfMonth}日時点は {formatYen(pace.lastYen, { sign: 'never' })}。
      {pace.diffYen === 0 ? (
        ' 今月はちょうど同じです。'
      ) : (
        <>
          {' '}
          今月は{' '}
          <span className="tabular font-semibold whitespace-nowrap" style={{ color: 'var(--ink)' }}>
            {formatYen(pace.diffYen, { sign: 'never' })} {isLess ? '少ない' : '多い'}
          </span>
          。
        </>
      )}
    </p>
  );
}

function ForecastLine({ forecast }: { forecast: ForecastInfo }) {
  const projected = forecast.projectedTotalYen!;
  const over = forecast.totalBudgetYen === null ? null : projected - forecast.totalBudgetYen;
  return (
    <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
      このペースが続くと月末までに{' '}
      <span className="tabular font-semibold" style={{ color: 'var(--ink)' }}>
        {formatYen(projected, { sign: 'never' })}
      </span>
      {over === null ? (
        '。'
      ) : over > 0 ? (
        <>(予算の合計より {formatYen(over, { sign: 'never' })} 多い見込み)。</>
      ) : (
        <>(予算の合計に対して {formatYen(-over, { sign: 'never' })} の余裕)。</>
      )}
    </p>
  );
}
