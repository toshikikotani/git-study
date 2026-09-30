import { describe, expect, it } from 'vitest';

import { sortQuickEntryGenres, type QuickEntryGenreInput } from '@/domain/quick-entry-genres';

function genre(overrides: Partial<QuickEntryGenreInput>): QuickEntryGenreInput {
  return {
    id: 'g1',
    name: 'ジャンル',
    quickEntryOrder: null,
    hiddenInQuickEntry: false,
    usageCount: 0,
    ...overrides,
  };
}

describe('sortQuickEntryGenres(N2本人要件)', () => {
  it('既定は使用頻度の多い順', () => {
    const result = sortQuickEntryGenres([
      genre({ id: 'a', name: 'A', usageCount: 1 }),
      genre({ id: 'b', name: 'B', usageCount: 5 }),
      genre({ id: 'c', name: 'C', usageCount: 3 }),
    ]);
    expect(result.map((g) => g.id)).toEqual(['b', 'c', 'a']);
  });

  it('quickEntryOrder が入っているものは頻度より優先し、その値の昇順', () => {
    const result = sortQuickEntryGenres([
      genre({ id: 'a', name: 'A', usageCount: 100 }),
      genre({ id: 'b', name: 'B', quickEntryOrder: 20 }),
      genre({ id: 'c', name: 'C', quickEntryOrder: 10 }),
    ]);
    expect(result.map((g) => g.id)).toEqual(['c', 'b', 'a']);
  });

  it('hiddenInQuickEntry のジャンルは結果に含めない', () => {
    const result = sortQuickEntryGenres([
      genre({ id: 'a', name: 'A', hiddenInQuickEntry: true, usageCount: 100 }),
      genre({ id: 'b', name: 'B', usageCount: 1 }),
    ]);
    expect(result.map((g) => g.id)).toEqual(['b']);
  });

  it('頻度が同じなら名前順で安定する', () => {
    const result = sortQuickEntryGenres([
      genre({ id: 'a', name: 'い', usageCount: 1 }),
      genre({ id: 'b', name: 'あ', usageCount: 1 }),
    ]);
    expect(result.map((g) => g.id)).toEqual(['b', 'a']);
  });

  it('元の配列を変更しない', () => {
    const input = [genre({ id: 'a' }), genre({ id: 'b' })];
    const frozen = [...input];
    sortQuickEntryGenres(input);
    expect(input).toEqual(frozen);
  });
});
