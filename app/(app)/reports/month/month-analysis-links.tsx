'use client';

import type { Route } from 'next';
import Link from 'next/link';

import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { useSpendingMonth } from '../../spending/spending-month-provider';
import { frequencyPoints, frequencySummary } from '../frequency';

/** リンクも要約も、月切替で選んだ同じ明細を使う。 */
export function MonthAnalysisLinks() {
  const { visibleMonth, transactions, loading } = useSpendingMonth();
  const month = visibleMonth.slice(0, 7);
  const summary = loading ? null : frequencySummary(frequencyPoints(transactions));

  return (
    <nav
      aria-label="ほかの分析"
      className="overflow-hidden rounded-2xl"
      style={{ background: 'var(--surface)' }}
    >
      <Row href={`/reports/frequency?month=${month}`} title="回数と1回の金額" sub={summary} />
      <Divider />
      <Row href="/reports/monthly" title="月ごとの表" sub="今月までの直近12か月" />
      <Divider />
      <Row href={`/reports/ai?month=${month}`} title="日次・月次のAIレポート" />
      <Divider />
      <Row href="/reports/more" title="そのほかの分析" sub="固定費・お店・資産・予測の確認" />
    </nav>
  );
}

function Divider() {
  return <div className="ml-4 h-px" style={{ background: 'var(--hairline)' }} />;
}

function Row({ href, title, sub }: { href: string; title: string; sub?: string | null }) {
  return (
    <Link
      href={href as Route}
      className="flex min-h-14 items-center gap-3 px-4"
      style={{ color: 'var(--ink)' }}
    >
      <span className="flex min-w-0 flex-1 flex-col py-2">
        <span className="text-[16px]">{title}</span>
        {sub ? (
          <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            {sub}
          </span>
        ) : null}
      </span>
      <span style={{ color: 'var(--ideal)' }}>
        <ChevronRightIcon />
      </span>
    </Link>
  );
}
