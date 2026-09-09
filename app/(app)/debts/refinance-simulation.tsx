'use client';

import { useActionState, useMemo, useState } from 'react';

import { Card } from '@/components/ui/card';
import { formatAnnualRate, formatYen, parseAnnualRate, MoneyError } from '@/domain/money';
import { compareRefinance, PayoffError, type Debt } from '@/domain/payoff';
import type {
  RepaymentStrategy as SettingsRepaymentStrategy,
  Scenario,
} from '@/features/scenarios/store';
import { formatDateJa } from '@/lib/date';
import {
  deleteScenarioAction,
  saveRefinanceScenarioAction,
  type ScenarioFormState,
} from './refinance-actions';

const INITIAL_STATE: ScenarioFormState = { error: null };

/**
 * 借り換えシミュレーション区画(FR-04, M1-4)。
 *
 * comparePlans()(M1-3、返済額を変えた効果)と対になる、金利だけを
 * 変えた効果を見る区画。domain/payoff.ts の compareRefinance() は純粋関数
 * なので、ここもサーバーを介さず即時再計算する。
 */
export function RefinanceSimulation({
  debts,
  monthlyBudgetYen,
  strategy,
  scenarios,
}: {
  debts: readonly Debt[];
  monthlyBudgetYen: number;
  strategy: SettingsRepaymentStrategy;
  scenarios: readonly Scenario[];
}) {
  const [rateInput, setRateInput] = useState('8');
  const normalizedStrategy = strategy === 'snowball' ? 'snowball' : 'avalanche';

  const result = useMemo(() => {
    try {
      const rate = parseAnnualRate(rateInput);
      return {
        ok: true as const,
        rate,
        ...compareRefinance(debts, monthlyBudgetYen, rate, { strategy: normalizedStrategy }),
      };
    } catch (e) {
      const message =
        e instanceof MoneyError || e instanceof PayoffError ? e.message : '計算できませんでした';
      return { ok: false as const, message };
    }
  }, [debts, monthlyBudgetYen, normalizedStrategy, rateInput]);

  const [state, formAction, pending] = useActionState(saveRefinanceScenarioAction, INITIAL_STATE);

  if (debts.length === 0) return null;

  return (
    <Card>
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        借り換えを試す
      </h2>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        今の金利のまま返済した場合と比べて、おまとめでどれだけ利息を減らせるかを見る
      </p>

      <label className="mt-4 block">
        <span className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
          借り換え後の年利
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={rateInput}
          onChange={(e) => setRateInput(e.target.value)}
          className="mt-1 w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />
      </label>

      <div className="mt-4">
        {result.ok ? (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-2xl p-3" style={{ background: 'var(--plane)' }}>
                <p style={{ color: 'var(--ink-muted)' }}>今の金利のまま</p>
                <p className="tabular mt-1 font-semibold" style={{ color: 'var(--ink)' }}>
                  {result.original.months}ヶ月
                </p>
                <p className="tabular mt-0.5" style={{ color: 'var(--ink-secondary)' }}>
                  利息 {formatYen(result.original.totalInterestYen, { sign: 'never' })}
                </p>
              </div>
              <div className="rounded-2xl p-3" style={{ background: 'var(--accent-track)' }}>
                <p style={{ color: 'var(--accent)' }}>{formatAnnualRate(result.rate)}に借り換え</p>
                <p className="tabular mt-1 font-semibold" style={{ color: 'var(--ink)' }}>
                  {result.refinanced.months}ヶ月
                </p>
                <p className="tabular mt-0.5" style={{ color: 'var(--ink-secondary)' }}>
                  利息 {formatYen(result.refinanced.totalInterestYen, { sign: 'never' })}
                </p>
              </div>
            </div>

            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
              借り換えると、
              <span className="tabular font-semibold" style={{ color: 'var(--accent)' }}>
                {result.shortenedMonths}ヶ月早く
              </span>
              、
              <span className="tabular font-semibold" style={{ color: 'var(--accent)' }}>
                {formatYen(result.savedInterestYen, { sign: 'never' })}
              </span>
              の利息を減らせます。
            </p>

            <form action={formAction} className="mt-4 flex gap-2">
              <input type="hidden" name="strategy" value={normalizedStrategy} />
              <input type="hidden" name="monthlyBudgetYen" value={monthlyBudgetYen} />
              <input type="hidden" name="overrideAnnualRate" value={result.rate} />
              <input type="hidden" name="monthsToPayoff" value={result.refinanced.months} />
              <input type="hidden" name="payoffOn" value={result.refinanced.payoffOn} />
              <input
                type="hidden"
                name="totalInterestYen"
                value={result.refinanced.totalInterestYen}
              />
              <input type="hidden" name="totalPaidYen" value={result.refinanced.totalPaidYen} />
              <input
                type="text"
                name="name"
                required
                placeholder="シナリオ名(例:A社おまとめ)"
                className="min-w-0 flex-1 rounded-xl px-3 py-2 text-xs"
                style={{
                  background: 'var(--plane)',
                  color: 'var(--ink)',
                  border: '1px solid var(--hairline)',
                }}
              />
              <button
                type="submit"
                disabled={pending}
                className="shrink-0 rounded-full px-4 py-2 text-xs font-semibold disabled:opacity-40"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {pending ? '保存中…' : '保存する'}
              </button>
            </form>
            {state.error ? (
              <p className="mt-2 text-xs" style={{ color: 'var(--over)' }}>
                {state.error}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--over)' }}>
            {result.message}
          </p>
        )}
      </div>

      {scenarios.length > 0 ? (
        <ul className="mt-4 space-y-2 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
          {scenarios.map((scenario) => (
            <li key={scenario.id} className="flex items-center justify-between gap-2 text-xs">
              <div>
                <p className="font-medium" style={{ color: 'var(--ink)' }}>
                  {scenario.name}
                </p>
                <p className="tabular mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                  {formatAnnualRate(scenario.overrideAnnualRate ?? 0)} ・ {scenario.monthsToPayoff}
                  ヶ月 ・ 利息 {formatYen(scenario.totalInterestYen ?? 0, { sign: 'never' })} ・
                  完済見込み {scenario.payoffOn ? formatDateJa(scenario.payoffOn) : '-'}
                </p>
              </div>
              <form action={deleteScenarioAction.bind(null, scenario.id)}>
                <button type="submit" className="shrink-0" style={{ color: 'var(--ink-muted)' }}>
                  削除
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
