'use client';

/**
 * 手入力の金額用の電卓キーパッド(N2)。src/domain/calculator.ts の
 * pressCalculatorKey() を UI にしただけで、計算そのものは持たない。
 */

import { useState } from 'react';

import {
  calculatorResultYen,
  INITIAL_CALCULATOR_STATE,
  pressCalculatorKey,
  type CalculatorKey,
} from '@/domain/calculator';

const ROWS: readonly (readonly CalculatorKey[])[] = [
  ['7', '8', '9', '÷'],
  ['4', '5', '6', '×'],
  ['1', '2', '3', '-'],
  ['AC', '0', 'DEL', '+'],
];

export function CalculatorKeypad({
  onConfirm,
}: {
  /** 「=」を押したときの計算結果(整数円)。 */
  onConfirm: (amountYen: number) => void;
}) {
  const [state, setState] = useState(INITIAL_CALCULATOR_STATE);

  function press(key: CalculatorKey): void {
    if (key === '=') {
      const next = pressCalculatorKey(state, key);
      setState(next);
      onConfirm(calculatorResultYen(next));
      return;
    }
    setState((s) => pressCalculatorKey(s, key));
  }

  return (
    <div className="mt-2 rounded-2xl p-3" style={{ background: 'var(--plane)' }}>
      <p
        className="tabular px-2 py-1 text-right text-2xl font-semibold"
        style={{ color: 'var(--ink)' }}
        aria-live="polite"
      >
        {Number(state.display).toLocaleString('ja-JP')}
      </p>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {ROWS.flat().map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => press(key)}
            className="min-h-11 rounded-xl text-lg font-semibold"
            style={{
              background:
                key === 'AC' || key === 'DEL' ? 'var(--surface)' : 'var(--surface-raised)',
              color: key === 'AC' ? 'var(--over)' : 'var(--ink)',
            }}
          >
            {key}
          </button>
        ))}
        <button
          type="button"
          onClick={() => press('=')}
          className="col-span-4 min-h-11 rounded-xl text-lg font-semibold"
          style={{ background: 'var(--action)', color: 'var(--on-action)' }}
        >
          =
        </button>
      </div>
    </div>
  );
}
