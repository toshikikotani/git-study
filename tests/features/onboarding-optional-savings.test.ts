import { describe, expect, it } from 'vitest';

import { optionalSavingsGoal } from '@/features/onboarding/optional-savings';
import { captureReturnTarget } from '@/features/receipt-captures/navigation';

describe('初回設定の任意の貯金目標', () => {
  it('何も追加しなければ主ボタンでそのまま完了できる', () => {
    expect(optionalSavingsGoal({ title: '', amountText: '', targetDate: '' })).toEqual({
      goal: null,
      error: null,
    });
    expect(optionalSavingsGoal({ title: '  ', amountText: ' ', targetDate: '' })).toEqual({
      goal: null,
      error: null,
    });
  });

  it('目的だけでも追加でき、金額と期限は必須にしない', () => {
    expect(optionalSavingsGoal({ title: '  旅行 ', amountText: '', targetDate: '' })).toEqual({
      goal: { title: '旅行', targetAmountYen: null, targetDate: null },
      error: null,
    });
  });

  it('入力された金額・期限を落とさず、目的がない途中入力は確認する', () => {
    expect(
      optionalSavingsGoal({ title: '旅行', amountText: '100,000', targetDate: '2027-04-01' }),
    ).toEqual({
      goal: { title: '旅行', targetAmountYen: 100000, targetDate: '2027-04-01' },
      error: null,
    });
    expect(
      optionalSavingsGoal({ title: '', amountText: '100000', targetDate: '' }).error,
    ).toContain('何のため');
    for (const amountText of ['0', '-100', 'abc']) {
      expect(optionalSavingsGoal({ title: '旅行', amountText, targetDate: '' }).error).toContain(
        '1円以上',
      );
    }
  });
});

describe('入力待ちの戻り先', () => {
  it('次の入力待ちへ戻る経路を保ち、外部URLや未知の経路は受け付けない', () => {
    // 入力待ちは「確認が必要」の画面にまとめた(古いリンクもそこへ、ADR-127)。
    expect(captureReturnTarget('/spending/review')).toEqual({
      href: '/spending/review',
      label: '確認が必要',
    });
    expect(captureReturnTarget('/spending?review=input').href).toBe('/spending/review');
    expect(captureReturnTarget('/').href).toBe('/');
    for (const value of [undefined, 'https://example.com', '//example.com', '/settings']) {
      expect(captureReturnTarget(value).href).toBe('/spending');
    }
  });
});
