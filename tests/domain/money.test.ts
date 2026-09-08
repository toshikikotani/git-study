import { describe, expect, it } from 'vitest';

import {
  MAX_YEN,
  MoneyError,
  assertYen,
  formatAnnualRate,
  formatSpendable,
  formatYen,
  monthlyInterest,
  parseAnnualRate,
  parseYen,
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
    expect(formatYen(-3500)).toBe('-3,500円');
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

describe('monthlyInterest', () => {
  it('年利は小数で受け、円未満を切り捨てる(SQL の floor と一致)', () => {
    expect(monthlyInterest(400_000, 0.15)).toBe(5000);
    expect(monthlyInterest(385_000, 0.15)).toBe(4812); // 4812.5 → 4812
    expect(monthlyInterest(300_000, 0.18)).toBe(4500);
  });

  it('残高が小さいと利息は0になる', () => {
    expect(monthlyInterest(1, 0.15)).toBe(0);
  });

  it('金利0%なら利息は0', () => {
    expect(monthlyInterest(1_000_000, 0)).toBe(0);
  });

  it('パーセント値を渡すと拒否する(15% は 0.15)', () => {
    expect(() => monthlyInterest(100_000, 15)).toThrow(/0〜1 の小数/);
  });

  it('負の金利を拒否する', () => {
    expect(() => monthlyInterest(100_000, -0.01)).toThrow(/0〜1 の小数/);
  });
});

describe('formatAnnualRate', () => {
  it('小数をパーセント表示にする', () => {
    expect(formatAnnualRate(0.15)).toBe('15%');
    expect(formatAnnualRate(0.1825)).toBe('18.25%');
    expect(formatAnnualRate(0)).toBe('0%');
  });
});

describe('parseAnnualRate(formatAnnualRate の逆変換)', () => {
  it('「15」を 0.15 にする', () => {
    expect(parseAnnualRate('15')).toBe(0.15);
  });

  it('% が付いていても解釈する', () => {
    expect(parseAnnualRate('15%')).toBe(0.15);
    expect(parseAnnualRate('18.25％')).toBeCloseTo(0.1825);
  });

  it('全角数字を吸収する', () => {
    expect(parseAnnualRate('１５')).toBe(0.15);
  });

  it('前後の空白を無視する', () => {
    expect(parseAnnualRate('  15 ')).toBe(0.15);
  });

  it('0% を許容する', () => {
    expect(parseAnnualRate('0')).toBe(0);
  });

  it('100% を許容する(境界値)', () => {
    expect(parseAnnualRate('100')).toBe(1);
  });

  it('100% を超える値は拒否する(桁間違いの防止)', () => {
    expect(() => parseAnnualRate('150')).toThrow(/0〜100%/);
  });

  it('負の値は拒否する', () => {
    expect(() => parseAnnualRate('-5')).toThrow(/解釈できません/);
  });

  it('空文字は拒否する', () => {
    expect(() => parseAnnualRate('')).toThrow(/空/);
  });

  it('数値でない入力は拒否する', () => {
    expect(() => parseAnnualRate('高い')).toThrow(/解釈できません/);
  });

  it('formatAnnualRate と往復できる', () => {
    const rate = 0.1825;
    expect(parseAnnualRate(formatAnnualRate(rate).replace('%', ''))).toBeCloseTo(rate);
  });
});
