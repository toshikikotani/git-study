import { describe, expect, it } from 'vitest';

import { resolveGenreHint } from '@/domain/genre-hint';

const GENRES = [
  { id: 'g1', name: '食費' },
  { id: 'g2', name: '日用品' },
];

describe('resolveGenreHint', () => {
  it('一致するジャンル名をidに解決する', () => {
    expect(resolveGenreHint('食費', GENRES)).toBe('g1');
  });
  it('nullはnullのまま', () => {
    expect(resolveGenreHint(null, GENRES)).toBeNull();
  });
  it('一致しない名前はnull', () => {
    expect(resolveGenreHint('交通費', GENRES)).toBeNull();
  });
});
