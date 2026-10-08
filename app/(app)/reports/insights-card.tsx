import type { Insight } from '@/domain/report-insights';

/** 気づき(数字から決まる原因と次の一手)。 */
export function InsightsList({ insights }: { insights: readonly Insight[] }) {
  if (insights.length === 0) return null;
  return (
    <section
      aria-label="気づき"
      className="glass rounded-[22px] px-4 py-4"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        気づき
      </p>
      <ul className="mt-2 space-y-3">
        {insights.map((insight) => (
          <li
            key={insight.key}
            className="text-sm leading-relaxed"
            style={{ color: insight.tone === 'caution' ? 'var(--ink)' : 'var(--ink-secondary)' }}
          >
            {insight.tone === 'caution' ? (
              <span aria-hidden style={{ color: 'var(--state-caution)' }}>
                ▲{' '}
              </span>
            ) : null}
            {insight.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
