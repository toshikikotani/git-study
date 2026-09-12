import { describe, expect, it } from 'vitest';

import { assertGmailFetchLimit, assertGmailFromAddresses } from '@/domain/gmail-settings';

describe('assertGmailFromAddresses(T-22)', () => {
  it('前後の空白を取り除く', () => {
    expect(assertGmailFromAddresses([' rakuten-card.co.jp '])).toEqual(['rakuten-card.co.jp']);
  });

  it('空配列は許可する(全件対象を意味する)', () => {
    expect(assertGmailFromAddresses([])).toEqual([]);
  });

  it('空文字の要素は拒否する', () => {
    expect(() => assertGmailFromAddresses(['smbc-card.com', '  '])).toThrow();
  });
});

describe('assertGmailFetchLimit(T-22)', () => {
  it('1〜1000の整数を受け付ける', () => {
    expect(assertGmailFetchLimit(200)).toBe(200);
    expect(assertGmailFetchLimit(1)).toBe(1);
    expect(assertGmailFetchLimit(1000)).toBe(1000);
  });

  it('範囲外は拒否する', () => {
    expect(() => assertGmailFetchLimit(0)).toThrow();
    expect(() => assertGmailFetchLimit(1001)).toThrow();
  });

  it('整数以外は拒否する', () => {
    expect(() => assertGmailFetchLimit(1.5)).toThrow();
    expect(() => assertGmailFetchLimit(NaN)).toThrow();
  });
});
