import { describe, expect, it } from 'vitest';

import { similarCategories } from '@/domain/genre-similarity';

describe('似た名前のカテゴリ(デザイン仕様書のカテゴリの設定)', () => {
  const cats = [
    { id: 'a', name: '医療費' },
    { id: 'b', name: '医療・健康' },
    { id: 'c', name: '外食' },
    { id: 'd', name: '食料品' },
    { id: 'e', name: 'カフェ・飲料' },
  ];

  it('先頭2文字が同じなら似ている(区切りは無視)', () => {
    const map = similarCategories(cats);
    expect(map.get('a')).toEqual({ id: 'b', name: '医療・健康' });
    expect(map.get('b')).toEqual({ id: 'a', name: '医療費' });
  });

  it('関係のない名前は似ていない', () => {
    const map = similarCategories(cats);
    expect(map.has('c')).toBe(false);
    expect(map.has('d')).toBe(false);
    expect(map.has('e')).toBe(false);
  });

  it('一方がもう一方を含めば似ている', () => {
    const map = similarCategories([
      { id: 'x', name: '交通' },
      { id: 'y', name: '公共交通' },
    ]);
    expect(map.get('x')?.id).toBe('y');
  });
});
