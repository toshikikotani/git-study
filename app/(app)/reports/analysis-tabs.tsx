import type { Route } from 'next';
import Link from 'next/link';

const TABS = [
  { href: '/reports', key: 'goal', label: '目標' },
  { href: '/reports/month', key: 'month', label: '月のふりかえり' },
] as const;

/** 分析の「目標 / 月のふりかえり」(デザイン仕様書、ADR-091)。切り替えの見た目のリンク。 */
export function AnalysisTabs({ current }: { current: 'goal' | 'month' }) {
  return (
    <nav
      aria-label="分析の種類"
      className="grid grid-cols-2"
      style={{ background: 'var(--field)', borderRadius: 10, padding: 2, gap: 2 }}
    >
      {TABS.map((tab) => {
        const on = tab.key === current;
        return (
          <Link
            key={tab.key}
            href={tab.href as Route}
            aria-current={on ? 'page' : undefined}
            className={`flex min-h-11 items-center justify-center text-[14px] ${on ? 'font-semibold' : 'font-medium'}`}
            style={{
              borderRadius: 8,
              background: on ? 'var(--surface)' : 'transparent',
              color: on ? 'var(--ink)' : 'var(--ink-secondary)',
              boxShadow: on ? '0 1px 3px rgba(0, 0, 0, 0.12)' : 'none',
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** 分析のまとまりの見出し(「いまの状況」など、22px)。 */
export function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mx-1 mt-4 text-[22px] font-bold" style={{ color: 'var(--ink)' }}>
      {children}
    </h2>
  );
}
