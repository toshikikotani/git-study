import { describe, expect, it } from 'vitest';

import { ScenarioError, assertScenarioName } from '@/domain/scenario';

describe('assertScenarioName', () => {
  it('前後の空白を取り除く', () => {
    expect(assertScenarioName('  A社おまとめ  ')).toBe('A社おまとめ');
  });

  it('空文字・空白のみは拒否する', () => {
    expect(() => assertScenarioName('')).toThrow(ScenarioError);
    expect(() => assertScenarioName('   ')).toThrow(/シナリオ名/);
  });
});
