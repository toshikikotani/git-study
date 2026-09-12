import { describe, expect, it } from 'vitest';

import { assertMilestoneTitle } from '@/domain/job-change';

describe('assertMilestoneTitle', () => {
  it('前後の空白を取り除く', () => {
    expect(assertMilestoneTitle('  応募書類を作る  ')).toBe('応募書類を作る');
  });

  it('空文字は拒否する', () => {
    expect(() => assertMilestoneTitle('   ')).toThrow();
  });
});
