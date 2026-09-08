import { describe, expect, it } from 'vitest';

import { AuthError, assertPassword, assertPasswordConfirmed } from '@/domain/auth';

describe('assertPassword', () => {
  it('8文字以上ならそのまま返す', () => {
    expect(assertPassword('correct-horse')).toBe('correct-horse');
  });

  it('8文字未満は拒否する', () => {
    expect(() => assertPassword('short1')).toThrow(AuthError);
    expect(() => assertPassword('short1')).toThrow(/8文字以上/);
  });
});

describe('assertPasswordConfirmed', () => {
  it('一致すればそのまま返す', () => {
    expect(assertPasswordConfirmed('correct-horse', 'correct-horse')).toBe('correct-horse');
  });

  it('不一致は拒否する', () => {
    expect(() => assertPasswordConfirmed('correct-horse', 'battery-staple')).toThrow(
      /一致しません/,
    );
  });
});
