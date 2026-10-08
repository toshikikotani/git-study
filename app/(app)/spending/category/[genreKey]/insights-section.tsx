'use client';

import { hapticFor } from '@/lib/haptics';
import type { Insight } from '@/features/category/insights';

/**
 * 気づきカード(最大3つ。該当がなければカードごと出さない)。事実と、次にできることだけを書く。
 * タップすると、根拠の取引に絞り込む(取引の一覧の上に「○○で絞り込み中 ×」が出る)。
 */
export function InsightsSection({
  insights,
  onFocus,
}: {
  insights: readonly Insight[];
  onFocus: (insight: Insight) => void;
}) {
  if (insights.length === 0) return null;
  return (
    <section aria-label="気づき" className="space-y-2">
      <h2 className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
        気づき
      </h2>
      <ul className="space-y-2">
        {insights.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              onClick={() => {
                hapticFor('filterChange');
                onFocus(i);
              }}
              aria-label={`${i.message}(根拠の取引${i.evidenceTxIds.length}件を表示)`}
              className="glass min-h-11 block w-full rounded-2xl p-4 text-left"
              style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
            >
              <p className="text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
                {i.message}
              </p>
              <p className="mt-1 text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
                根拠の取引 {i.evidenceTxIds.length}件を見る →
              </p>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
