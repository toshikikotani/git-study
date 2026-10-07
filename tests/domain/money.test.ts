import { describe, expect, it } from 'vitest';

import {
  MAX_YEN,
  MoneyError,
  assertYen,
  formatSpendable,
  formatYen,
  parseYen,
  toTaxIncluded,
} from '@/domain/money';

describe('assertYen', () => {
  it('整数の円を通す', () => {
    expect(assertYen(0)).toBe(0);
    expect(assertYen(-3500)).toBe(-3500);
  });

  it('小数を拒否する(ADR-008)', () => {
    expect(() => assertYen(100.5)).toThrow(MoneyError);
  });

  it('NaN / Infinity を拒否する', () => {
    expect(() => assertYen(Number.NaN)).toThrow(/数値ではありません/);
    expect(() => assertYen(Number.POSITIVE_INFINITY)).toThrow(/数値ではありません/);
  });

  it('桁の打ち間違いとみなせる巨大な値を拒否する', () => {
    expect(() => assertYen(MAX_YEN + 1)).toThrow(/上限/);
  });
});

describe('formatYen', () => {
  it('桁区切りと円を付ける', () => {
    expect(formatYen(1234567)).toBe('1,234,567円');
    expect(formatYen(-3500)).toBe('\u22123,500円');
    expect(formatYen(-3500)).not.toContain('-');
  });

  it('sign: never で符号を落とす(支出額を正で見せたいとき)', () => {
    expect(formatYen(-3500, { sign: 'never' })).toBe('3,500円');
  });
});

describe('formatSpendable(FR-64)', () => {
  it('残額は肯定形で示す', () => {
    expect(formatSpendable(10000)).toBe('あと10,000円使える');
    expect(formatSpendable(0)).toBe('あと0円使える');
  });

  it('超過しても責めない文言にする(設計原則5)', () => {
    const message = formatSpendable(-5000);
    expect(message).toBe('予算を5,000円超えている');
    expect(message).not.toMatch(/使いすぎ|ダメ|注意|警告/);
  });
});

describe('parseYen(ADR-007 の表記ゆれ吸収)', () => {
  it('桁区切りカンマを外す', () => {
    expect(parseYen('1,234,567')).toBe(1234567);
  });

  it('全角数字を半角にする', () => {
    expect(parseYen('１２３４')).toBe(1234);
    expect(parseYen('１，２３４')).toBe(1234);
  });

  it('通貨記号と空白を無視する', () => {
    expect(parseYen(' ¥3,500 ')).toBe(3500);
    expect(parseYen('￥3500')).toBe(3500);
  });

  it('会計表記の括弧をマイナスとして扱う', () => {
    expect(parseYen('(1,234)')).toBe(-1234);
  });

  it('明示的な符号を扱う', () => {
    expect(parseYen('-3500')).toBe(-3500);
    expect(parseYen('＋3500')).toBe(3500);
  });

  it('空文字を拒否する', () => {
    expect(() => parseYen('   ')).toThrow(/空/);
  });

  it('数値でない文字列を拒否する', () => {
    expect(() => parseYen('お買い上げ')).toThrow(/解釈できません/);
    expect(() => parseYen('1,2x4')).toThrow(/解釈できません/);
  });

  it('円未満の端数を拒否する', () => {
    expect(() => parseYen('100.5')).toThrow(/端数/);
  });
});

describe('toTaxIncluded(N2本人要件「税込8%/税込10%ボタン」)', () => {
  it('8%を税込に換算する(既定は切り捨て)', () => {
    expect(toTaxIncluded(100, 8)).toBe(108);
  });

  it('10%を税込に換算する', () => {
    expect(toTaxIncluded(100, 10)).toBe(110);
  });

  it('端数は既定で切り捨てる', () => {
    expect(toTaxIncluded(127, 8)).toBe(137); // 127 * 1.08 = 137.16
  });

  it('rounding: round を指定すると四捨五入する', () => {
    expect(toTaxIncluded(127, 8, 'round')).toBe(137); // 137.16 → 137
    expect(toTaxIncluded(150, 8, 'round')).toBe(162); // 162.0 ちょうど
    expect(toTaxIncluded(163, 8, 'round')).toBe(176); // 176.04 → 176
  });

  it('rounding: ceil を指定すると切り上げる', () => {
    expect(toTaxIncluded(127, 8, 'ceil')).toBe(138); // 137.16 → 138
  });

  it('0円は0円のまま', () => {
    expect(toTaxIncluded(0, 10)).toBe(0);
  });
});
