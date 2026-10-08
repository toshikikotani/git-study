'use client';

/**
 * 固定費/変動費(N4)。定期的な支出を自動で検出して固定費の候補にし、
 * 本人の確認で確定する。確定していないあいだは、その支出は変動費として
 * 数える(誤って固定費扱いにしないための既定)。
 */

import { useState } from 'react';

import { formatYen } from '@/domain/money';
import type { DetectedSubscription } from '@/domain/subscriptions';
import { confirmFixedCostAction, unconfirmFixedCostAction } from './fixed-cost-actions';

export function FixedVariableCard({
  fixedYen,
  variableYen,
  candidates,
  confirmedKeys,
}: {
  fixedYen: number;
  variableYen: number;
  /** detectSubscriptions() の結果(直近12ヶ月)。 */
  candidates: readonly DetectedSubscription[];
  confirmedKeys: readonly string[];
}) {
  const [scope, setScope] = useState<'fixed' | 'variable'>('variable');
  const [confirmed, setConfirmed] = useState(new Set(confirmedKeys));
  const [pending, setPending] = useState<string | null>(null);

  const unconfirmedCandidates = candidates.filter((c) => !confirmed.has(c.key));
  const confirmedCandidates = candidates.filter((c) => confirmed.has(c.key));

  async function confirm(key: string): Promise<void> {
    setPending(key);
    const result = await confirmFixedCostAction(key);
    setPending(null);
    if (result.error === null) setConfirmed((prev) => new Set(prev).add(key));
  }

  async function unconfirm(key: string): Promise<void> {
    setPending(key);
    const result = await unconfirmFixedCostAction(key);
    setPending(null);
    if (result.error === null) {
      setConfirmed((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  return (
    <div
      className="glass rounded-[22px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        固定費 / 変動費
      </h2>

      <div
        role="radiogroup"
        aria-label="固定費・変動費の切り替え"
        className="mt-3 flex gap-1 text-xs"
      >
        {(
          [
            ['variable', `変動費 ${formatYen(variableYen, { sign: 'never' })}`],
            ['fixed', `固定費 ${formatYen(fixedYen, { sign: 'never' })}`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={scope === value}
            onClick={() => setScope(value)}
            className="min-h-11 flex-1 rounded-full font-semibold"
            style={{
              background: scope === value ? 'var(--accent)' : 'var(--plane)',
              color: scope === value ? 'var(--on-accent)' : 'var(--ink-secondary)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {scope === 'fixed' ? (
        <div className="mt-3 space-y-1">
          {confirmedCandidates.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              固定費として確定したものはまだありません。
            </p>
          ) : (
            confirmedCandidates.map((c) => (
              <div
                key={c.key}
                className="flex items-center gap-2 rounded-xl px-2 py-2"
                style={{ background: 'var(--plane)' }}
              >
                <span className="min-w-0 flex-1 truncate text-sm" style={{ color: 'var(--ink)' }}>
                  {c.label}
                </span>
                <span className="tabular text-sm" style={{ color: 'var(--ink-secondary)' }}>
                  {formatYen(c.amountYen, { sign: 'never' })}
                </span>
                <button
                  type="button"
                  disabled={pending === c.key}
                  onClick={() => void unconfirm(c.key)}
                  className="min-h-11 rounded-full px-3 text-xs font-semibold disabled:opacity-40"
                  style={{ background: 'var(--surface)', color: 'var(--ink-secondary)' }}
                >
                  解除
                </button>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-1">
          {unconfirmedCandidates.length === 0 ? null : (
            <>
              <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                定期的な支出の候補(確定すると固定費として数えます)
              </p>
              {unconfirmedCandidates.map((c) => (
                <div
                  key={c.key}
                  className="flex items-center gap-2 rounded-xl px-2 py-2"
                  style={{ background: 'var(--plane)' }}
                >
                  <span className="min-w-0 flex-1 truncate text-sm" style={{ color: 'var(--ink)' }}>
                    {c.label}
                  </span>
                  <span className="tabular text-sm" style={{ color: 'var(--ink-secondary)' }}>
                    {formatYen(c.amountYen, { sign: 'never' })}
                  </span>
                  <button
                    type="button"
                    disabled={pending === c.key}
                    onClick={() => void confirm(c.key)}
                    className="min-h-11 rounded-full px-3 text-xs font-semibold disabled:opacity-40"
                    style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
                  >
                    固定費にする
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
