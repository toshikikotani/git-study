import Link from 'next/link';

import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { loadMonthlyReport } from '@/features/ai-report/store';
import { todayJst } from '@/lib/date';

/**
 * 今日の画面の「AIの気づき」1行(提案書「AIレポートは分析の気づきと今日の1行に」、ADR-127)。今月の
 * AIの分析のいちばん上の気づきだけを出し、押すと分析 › 目標(気づきの全部と「もう一度分析する」)。
 * まだ分析していなければ何も出さない。
 */
export async function AiInsightLine() {
  const report = await loadMonthlyReport(todayJst().slice(0, 7)).catch(() => null);
  const first = report?.insights[0];
  if (!first) return null;
  return (
    <Link
      href="/reports"
      className="flex min-h-14 items-center gap-3 rounded-[22px] px-4 py-3"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
          ✦ AIの気づき
        </span>
        <span className="text-[15px] leading-snug">{first}</span>
      </span>
      <span style={{ color: 'var(--ideal)' }}>
        <ChevronRightIcon />
      </span>
    </Link>
  );
}
