'use client';

import { useMemo, useState } from 'react';

import { Card } from '@/components/ui/card';
import { formatYen } from '@/domain/money';
import { comparePlans, PayoffError, type Debt } from '@/domain/payoff';
import type { RepaymentStrategy as SettingsRepaymentStrategy } from '@/features/settings/store';
import { formatDateJa, type DateOnly } from '@/lib/date';

/** アバランチ/スノーボールの2択。app_settings が持ちうる 'minimum'/'custom' は対象外。 */
type ToggleableStrategy = 'avalanche' | 'snowball';

const STRATEGY_LABELS: Record<ToggleableStrategy, string> = {
  avalanche: '金利が高い順',
  snowball: '残高が少ない順',
};

const STEP_YEN = 1_000;

/**
 * 完済シミュレーション区画(FR-02, M1-3)。
 *
 * スライダーは Client Component にして、往復なしで即座に再計算する
 * (domain/payoff.ts は純粋関数なので、サーバーを介さず画面内で完結する)。
 */
export function PayoffSimulation({
  debts,
  initialMonthlyBudgetYen,
  initialStrategy,
}: {
  debts: readonly Debt[];
  initialMonthlyBudgetYen: number;
  initialStrategy: SettingsRepaymentStrategy;
}) {
  const totalMinimumYen = useMemo(
    () => debts.reduce((acc, d) => acc + d.minimumPaymentYen, 0),
    [debts],
  );
  const totalBalanceYen = useMemo(() => debts.reduce((acc, d) => acc + d.balanceYen, 0), [debts]);

  const minYen = Math.max(totalMinimumYen, STEP_YEN);
  const maxYen = Math.max(minYen + STEP_YEN, totalBalanceYen, initialMonthlyBudgetYen * 3);

  const [monthlyBudgetYen, setMonthlyBudgetYen] = useState(
    Math.min(Math.max(initialMonthlyBudgetYen, minYen), maxYen),
  );
  const [strategy, setStrategy] = useState<ToggleableStrategy>(
    initialStrategy === 'snowball' ? 'snowball' : 'avalanche',
  );

  const result = useMemo(() => {
    try {
      return { ok: true as const, ...comparePlans(debts, monthlyBudgetYen, { strategy }) };
    } catch (e) {
      const message = e instanceof PayoffError ? e.message : 'シミュレーションできませんでした';
      return { ok: false as const, message };
    }
  }, [debts, monthlyBudgetYen, strategy]);

  if (debts.length === 0) return null;

  return (
    <Card>
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        月々の返済額を試す
      </h2>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        最低返済のみを続けた場合と比べて、どれだけ早く・安く終えられるかを見る
      </p>

      <div className="mt-4 flex gap-1.5">
        {(Object.keys(STRATEGY_LABELS) as ToggleableStrategy[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStrategy(s)}
            className="rounded-full px-3 py-1.5 text-xs font-medium"
            style={
              strategy === s
                ? { background: 'var(--accent)', color: '#fff' }
                : { background: 'var(--plane)', color: 'var(--ink-secondary)' }
            }
          >
            {STRATEGY_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
            毎月の返済額
          </span>
          <span className="tabular text-lg font-semibold" style={{ color: 'var(--ink)' }}>
            {formatYen(monthlyBudgetYen, { sign: 'never' })}
          </span>
        </div>
        <input
          type="range"
          min={minYen}
          max={maxYen}
          step={STEP_YEN}
          value={monthlyBudgetYen}
          onChange={(e) => setMonthlyBudgetYen(Number(e.target.value))}
          className="mt-2 w-full accent-[var(--accent)]"
          aria-label="毎月の返済額"
        />
        <div
          className="mt-1 flex justify-between text-[11px]"
          style={{ color: 'var(--ink-muted)' }}
        >
          <span>{formatYen(minYen, { sign: 'never' })}</span>
          <span>{formatYen(maxYen, { sign: 'never' })}</span>
        </div>
      </div>

      <div className="mt-5">
        {result.ok ? (
          <ComparisonTable
            baselineMonths={result.baseline.months}
            baselineInterestYen={result.baseline.totalInterestYen}
            proposedMonths={result.proposed.months}
            proposedPayoffOn={result.proposed.payoffOn}
            proposedInterestYen={result.proposed.totalInterestYen}
            savedInterestYen={result.savedInterestYen}
            shortenedMonths={result.shortenedMonths}
          />
        ) : (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--over)' }}>
            {result.message}
          </p>
        )}
      </div>
    </Card>
  );
}

function ComparisonTable({
  baselineMonths,
  baselineInterestYen,
  proposedMonths,
  proposedPayoffOn,
  proposedInterestYen,
  savedInterestYen,
  shortenedMonths,
}: {
  baselineMonths: number;
  baselineInterestYen: number;
  proposedMonths: number;
  proposedPayoffOn: DateOnly;
  proposedInterestYen: number;
  savedInterestYen: number;
  shortenedMonths: number;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-2xl p-3" style={{ background: 'var(--plane)' }}>
          <p style={{ color: 'var(--ink-muted)' }}>最低返済のみ</p>
          <p className="tabular mt-1 font-semibold" style={{ color: 'var(--ink)' }}>
            {baselineMonths}ヶ月
          </p>
          <p className="tabular mt-0.5" style={{ color: 'var(--ink-secondary)' }}>
            利息 {formatYen(baselineInterestYen, { sign: 'never' })}
          </p>
        </div>
        <div className="rounded-2xl p-3" style={{ background: 'var(--accent-track)' }}>
          <p style={{ color: 'var(--accent)' }}>この金額で返済</p>
          <p className="tabular mt-1 font-semibold" style={{ color: 'var(--ink)' }}>
            {proposedMonths}ヶ月
          </p>
          <p className="tabular mt-0.5" style={{ color: 'var(--ink-secondary)' }}>
            利息 {formatYen(proposedInterestYen, { sign: 'never' })}
          </p>
        </div>
      </div>

      <p className="text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
        最低返済だけの場合より、
        <span className="tabular font-semibold" style={{ color: 'var(--accent)' }}>
          {shortenedMonths}ヶ月早く
        </span>
        、
        <span className="tabular font-semibold" style={{ color: 'var(--accent)' }}>
          {formatYen(savedInterestYen, { sign: 'never' })}
        </span>
        の利息を減らせます。完済見込みは {formatDateJa(proposedPayoffOn)}。
      </p>
    </div>
  );
}
