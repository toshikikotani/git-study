/**
 * 手入力の金額計算機(N2本人要件「電卓キーパッドを付ける。四則演算、AC、Del。
 * 計算結果がそのまま金額になる」)。
 *
 * 普通の電卓と同じ、演算子の優先順位を持たない「左から順に計算する」方式
 * (`1000 + 500 × 2` は `(1000+500)×2` になる)。関数電卓ではなく買い物の
 * 合計を素早く足すための道具であるため、この単純さで十分と判断した。
 */

export type CalculatorOp = '+' | '-' | '×' | '÷';
export type CalculatorKey = CalculatorOp | '=' | 'AC' | 'DEL' | `${number}`;

export type CalculatorState = {
  /** 画面に出す文字列(未確定の入力中の数値)。 */
  display: string;
  /** 直前までの計算結果。 */
  accumulator: number | null;
  pendingOp: CalculatorOp | null;
  /** true のとき、次の数字入力で display を置き換える(=・演算子を押した直後)。 */
  clearOnNextDigit: boolean;
};

export const INITIAL_CALCULATOR_STATE: CalculatorState = {
  display: '0',
  accumulator: null,
  pendingOp: null,
  clearOnNextDigit: false,
};

/** 金額は整数円のみ扱う(このアプリの金額はすべて整数円、ADR-061)。 */
const MAX_DIGITS = 9;

function currentValue(state: CalculatorState): number {
  const n = Number(state.display);
  return Number.isFinite(n) ? n : 0;
}

function applyOp(a: number, op: CalculatorOp, b: number): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '×':
      return a * b;
    case '÷':
      return b === 0 ? a : Math.round(a / b);
  }
}

export function pressCalculatorKey(state: CalculatorState, key: CalculatorKey): CalculatorState {
  if (key === 'AC') return INITIAL_CALCULATOR_STATE;

  if (key === 'DEL') {
    if (state.clearOnNextDigit) return INITIAL_CALCULATOR_STATE;
    const trimmed = state.display.length > 1 ? state.display.slice(0, -1) : '0';
    return { ...state, display: trimmed };
  }

  if (key === '=') {
    if (state.pendingOp === null || state.accumulator === null) {
      return { ...state, clearOnNextDigit: true };
    }
    const result = applyOp(state.accumulator, state.pendingOp, currentValue(state));
    return {
      display: String(result),
      accumulator: null,
      pendingOp: null,
      clearOnNextDigit: true,
    };
  }

  if (key === '+' || key === '-' || key === '×' || key === '÷') {
    const value = currentValue(state);
    if (state.pendingOp !== null && state.accumulator !== null && !state.clearOnNextDigit) {
      const result = applyOp(state.accumulator, state.pendingOp, value);
      return {
        display: String(result),
        accumulator: result,
        pendingOp: key,
        clearOnNextDigit: true,
      };
    }
    return { ...state, accumulator: value, pendingOp: key, clearOnNextDigit: true };
  }

  // 数字キー
  if (state.clearOnNextDigit) {
    return {
      display: key === '0' ? '0' : key,
      accumulator: state.accumulator,
      pendingOp: state.pendingOp,
      clearOnNextDigit: false,
    };
  }
  if (state.display === '0') return { ...state, display: key, clearOnNextDigit: false };
  if (state.display.replace('-', '').length >= MAX_DIGITS) return state;
  return { ...state, display: state.display + key };
}

/** 現在の表示を金額(整数円)として取り出す。 */
export function calculatorResultYen(state: CalculatorState): number {
  return Math.round(currentValue(state));
}
