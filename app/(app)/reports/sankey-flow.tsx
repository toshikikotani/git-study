'use client';

import { genreColorVar } from '@/domain/genre-style';
import { formatYen } from '@/domain/money';

export type SankeyGenre = {
  name: string;
  spentYen: number;
};

const MAX_TARGETS = 6;

/**
 * 今月のお金の流れをサンキー風に表示する。
 * 左: 収入または支出合計 / 右: ジャンル別支出
 */
export function SankeyFlow({
  incomeYen,
  genres,
}: {
  incomeYen: number;
  genres: readonly SankeyGenre[];
}) {
  const positive = genres.filter((g) => g.spentYen > 0);
  const totalSpent = positive.reduce((sum, g) => sum + g.spentYen, 0);

  if (positive.length === 0 && incomeYen <= 0) {
    return (
      <section
        className="glass space-y-2 rounded-2xl p-5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
          今月のお金の流れ
        </h2>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          今月の収支記録がまだありません。
        </p>
      </section>
    );
  }

  const sourceValue = Math.max(incomeYen, totalSpent);
  const sourceLabel = incomeYen > 0 ? '収入' : '支出合計';

  const sorted = [...positive].sort((a, b) => b.spentYen - a.spentYen);
  const top = sorted.slice(0, MAX_TARGETS);
  const restYen = sorted.slice(MAX_TARGETS).reduce((sum, g) => sum + g.spentYen, 0);

  const items: { name: string; value: number; color: string }[] = top.map((g) => ({
    name: g.name || '未分類',
    value: g.spentYen,
    color: genreColorVar(g.name),
  }));
  if (restYen > 0) {
    items.push({ name: 'その他', value: restYen, color: 'var(--ink-muted)' });
  }
  const surplus = incomeYen > totalSpent ? incomeYen - totalSpent : 0;
  if (surplus > 0) {
    items.push({ name: '残り', value: surplus, color: 'var(--state-ok)' });
  }

  if (items.length === 0) {
    return (
      <section
        className="glass space-y-2 rounded-2xl p-5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
          今月のお金の流れ
        </h2>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          表示できる支出がありません。
        </p>
      </section>
    );
  }

  const total = items.reduce((sum, it) => sum + it.value, 0);
  if (total <= 0) return null;

  // 単純な横バー形式のフロー表示
  return (
    <section
      className="glass space-y-3 rounded-2xl p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
        今月のお金の流れ
      </h2>

      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        {sourceLabel} {formatYen(sourceValue, { sign: 'never' })} → ジャンル別支出
      </p>

      <div className="space-y-2">
        {items.map((item, i) => {
          const ratio = item.value / total;
          const pct = Math.round(ratio * 100);
          return (
            <div key={i} className="flex items-center gap-2">
              <div
                className="w-16 shrink-0 text-right text-xs tabular"
                style={{ color: 'var(--ink-secondary)' }}
              >
                {item.name.length > 6 ? `${item.name.slice(0, 5)}…` : item.name}
              </div>
              <div
                className="h-6 flex-1 overflow-hidden rounded-full"
                style={{ background: 'var(--plane)' }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max(4, pct)}%`,
                    background: item.color,
                    opacity: 0.85,
                  }}
                />
              </div>
              <div
                className="w-20 shrink-0 text-right text-xs tabular"
                style={{ color: 'var(--ink)' }}
              >
                {formatYen(item.value, { sign: 'never' })}
                <span className="ml-1 text-[10px]" style={{ color: 'var(--ink-muted)' }}>
                  {pct}%
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs tabular"
        style={{ borderColor: 'var(--plane)', color: 'var(--ink-secondary)' }}
      >
        <span>
          {sourceLabel}:{' '}
          <strong style={{ color: 'var(--ink)' }}>
            {formatYen(sourceValue, { sign: 'never' })}
          </strong>
        </span>
        <span>
          支出合計:{' '}
          <strong style={{ color: 'var(--ink)' }}>
            {formatYen(totalSpent, { sign: 'never' })}
          </strong>
        </span>
        {surplus > 0 ? (
          <span>
            残り:{' '}
            <strong style={{ color: 'var(--state-ok)' }}>
              {formatYen(surplus, { sign: 'never' })}
            </strong>
          </span>
        ) : null}
      </div>
    </section>
  );
}
