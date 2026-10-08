import type { Route } from 'next';
import Link from 'next/link';

import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { formatEstimate, formatSignedEstimate } from '@/domain/forecast/format';

export type HomeListProps = {
  /** 月末に残る見込み(収入 − 支出の中央)。収入が無ければ null。 */
  balance: { p50: number; incomeYen: number } | null;
  pendingCount: number;
  /** 貯金の行(本人の選択で、デザインの一覧に足した)。 */
  savings: { title: string; detail: string } | null;
};

/** ホームの一番下の一覧(デザインの「今日」、ADR-085):月末に残る見込み・確認待ち・貯金。 */
export function HomeList({ balance, pendingCount, savings }: HomeListProps) {
  const rows: React.ReactNode[] = [];
  if (balance) {
    rows.push(
      <div key="balance" className="flex min-h-11 items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <p className="text-base" style={{ color: 'var(--ink)' }}>
            月末に残る見込み
          </p>
          <p className="tabular text-xs" style={{ color: 'var(--ink-secondary)' }}>
            収入 {formatEstimate(balance.incomeYen, { approx: false }).replace('円', '')} − 支出{' '}
            {formatEstimate(balance.incomeYen - balance.p50, { approx: false }).replace('円', '')}
          </p>
        </div>
        <span className="tabular shrink-0 text-xl font-bold" style={{ color: 'var(--ink)' }}>
          {formatSignedEstimate(balance.p50)}
        </span>
      </div>,
    );
  }
  rows.push(
    <LinkRow
      key="pending"
      href="/spending"
      label="確認待ちの記録"
      value={`${pendingCount}件`}
      dot
    />,
  );
  if (savings) {
    rows.push(
      <LinkRow key="savings" href="/savings" label={savings.title} value={savings.detail} />,
    );
  }
  return (
    <section
      aria-label="そのほか"
      className="overflow-hidden rounded-[24px]"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      {rows.map((row, i) => (
        <div key={i} style={i > 0 ? { borderTop: '1px solid var(--hairline)' } : undefined}>
          {row}
        </div>
      ))}
    </section>
  );
}

function LinkRow({
  href,
  label,
  value,
  dot = false,
}: {
  href: string;
  label: string;
  value: string;
  dot?: boolean;
}) {
  return (
    <Link
      href={href as Route}
      className="flex min-h-12 items-center justify-between gap-3 px-5 py-4"
      style={{ color: 'var(--ink)' }}
    >
      <span className="flex min-w-0 items-center gap-3 text-base">
        {dot ? (
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ background: 'var(--accent)' }}
          />
        ) : null}
        {label}
      </span>
      <span
        className="tabular flex shrink-0 items-center gap-2 text-base"
        style={{ color: 'var(--ink-secondary)' }}
      >
        {value}
        <ChevronRightIcon />
      </span>
    </Link>
  );
}
