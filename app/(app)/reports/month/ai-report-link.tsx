'use client';

import type { Route } from 'next';
import Link from 'next/link';

import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { useSpendingMonth } from '../../spending/spending-month-provider';

/**
 * 月のふりかえりから開くAIのレポート(ADR-128)。月の切り替えで選んだ月のレポートを開く(今月なら日次・
 * 月次を作る・更新する、前の月ならその月に保存したレポート)。目標を立てていない月でも開ける。
 */
export function AiReportLink() {
  const { visibleMonth, isCurrentMonth } = useSpendingMonth();
  return (
    <Link
      href={`/reports/ai?month=${visibleMonth.slice(0, 7)}` as Route}
      className="flex min-h-14 items-center gap-3 rounded-[22px] px-4 py-3"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[17px] font-semibold">✦ AIのレポート</span>
        <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          {isCurrentMonth
            ? '今日・今月の気づき・アドバイス・タイプ診断・見込みの読み'
            : 'この月に保存したレポート'}
        </span>
      </span>
      <span style={{ color: 'var(--ink-muted)' }}>
        <ChevronRightIcon />
      </span>
    </Link>
  );
}
