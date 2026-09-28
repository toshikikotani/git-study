import { describe, expect, it } from 'vitest';

import {
  buildFromAiRows,
  type GenreClassifiable,
  type GenreOption,
} from '@/features/genre/genre-ai';

describe('buildFromAiRows', () => {
  const requested: GenreClassifiable[] = [
    { id: 't1', label: 'コーラ', amountYen: 150 },
    { id: 't2', label: 'ラーメン屋', amountYen: 800 },
  ];
  const genreOptions: GenreOption[] = [
    { id: 'g1', name: 'カフェ・飲料' },
    { id: 'g2', name: '外食' },
  ];

  it('正しく一致した行をジャンルidへ解決する', () => {
    const result = buildFromAiRows(
      [
        { id: 't1', genre_name: 'カフェ・飲料' },
        { id: 't2', genre_name: '外食' },
      ],
      requested,
      genreOptions,
    );
    expect(result.classifications).toEqual([
      { id: 't1', genreId: 'g1' },
      { id: 't2', genreId: 'g2' },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('要求していないidは無視する', () => {
    const result = buildFromAiRows([{ id: 't9', genre_name: '外食' }], requested, genreOptions);
    expect(result.classifications).toEqual([]);
    expect(result.warnings[0]).toContain('2件');
  });

  it('重複したidは最初の1件のみ採用する', () => {
    const result = buildFromAiRows(
      [
        { id: 't1', genre_name: 'カフェ・飲料' },
        { id: 't1', genre_name: '外食' },
      ],
      requested,
      genreOptions,
    );
    expect(result.classifications).toEqual([{ id: 't1', genreId: 'g1' }]);
  });

  it('選択肢に無いジャンル名は捨てる', () => {
    const result = buildFromAiRows(
      [{ id: 't1', genre_name: '存在しないジャンル' }],
      requested,
      genreOptions,
    );
    expect(result.classifications).toEqual([]);
  });

  it('要求件数に満たなければ不足件数を警告する', () => {
    const result = buildFromAiRows(
      [{ id: 't1', genre_name: 'カフェ・飲料' }],
      requested,
      genreOptions,
    );
    expect(result.classifications).toHaveLength(1);
    expect(result.warnings[0]).toContain('1件');
  });
});
