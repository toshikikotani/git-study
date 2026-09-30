import { describe, expect, it } from 'vitest';

import {
  calculatorResultYen,
  INITIAL_CALCULATOR_STATE,
  pressCalculatorKey,
  type CalculatorKey,
  type CalculatorState,
} from '@/domain/calculator';

function press(keys: readonly CalculatorKey[], start: CalculatorState = INITIAL_CALCULATOR_STATE) {
  return keys.reduce(pressCalculatorKey, start);
}

describe('pressCalculatorKey(N2本人要件「電卓キーパッド」)', () => {
  it('数字を続けて押すと桁が増える', () => {
    const state = press(['1', '2', '3']);
    expect(state.display).toBe('123');
  });

  it('足し算:1000 + 500 = 1500', () => {
    const state = press(['1', '0', '0', '0', '+', '5', '0', '0', '=']);
    expect(state.display).toBe('1500');
  });

  it('引き算:2000 - 300 = 1700', () => {
    const state = press(['2', '0', '0', '0', '-', '3', '0', '0', '=']);
    expect(state.display).toBe('1700');
  });

  it('掛け算:150 × 3 = 450', () => {
    const state = press(['1', '5', '0', '×', '3', '=']);
    expect(state.display).toBe('450');
  });

  it('割り算は整数円に丸める:1000 ÷ 3 = 333', () => {
    const state = press(['1', '0', '0', '0', '÷', '3', '=']);
    expect(state.display).toBe('333');
  });

  it('演算子の優先順位を持たず、左から順に計算する:1000 + 500 × 2 = 3000', () => {
    const state = press(['1', '0', '0', '0', '+', '5', '0', '0', '×', '2', '=']);
    expect(state.display).toBe('3000');
  });

  it('AC で最初からやり直せる', () => {
    const state = press(['1', '2', '3', 'AC']);
    expect(state).toEqual(INITIAL_CALCULATOR_STATE);
  });

  it('Del は末尾の1文字を消す', () => {
    const state = press(['1', '2', '3', 'DEL']);
    expect(state.display).toBe('12');
  });

  it('Del で最後の1文字を消すと0に戻る', () => {
    const state = press(['5', 'DEL']);
    expect(state.display).toBe('0');
  });

  it('計算結果の直後に数字を押すと新しい入力として始まる', () => {
    const afterEquals = press(['1', '0', '+', '5', '=']);
    const state = press(['9'], afterEquals);
    expect(state.display).toBe('9');
  });

  it('0で割ると変化しない(エラーにしない)', () => {
    const state = press(['1', '0', '0', '÷', '0', '=']);
    expect(state.display).toBe('100');
  });

  it('calculatorResultYen は表示中の値を整数円として返す', () => {
    const state = press(['1', '5', '0', '0']);
    expect(calculatorResultYen(state)).toBe(1500);
  });
});
