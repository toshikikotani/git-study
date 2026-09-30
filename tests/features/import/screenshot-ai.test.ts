import { describe, expect, it } from 'vitest';

import { buildFromAiRows } from '@/features/import/screenshot-ai';

function row(overrides: Partial<Parameters<typeof buildFromAiRows>[0][number]> = {}) {
  return {
    occurred_on: '2026-09-29',
    amount_yen: 1200,
    store_name: 'Amazon',
    genre_hint: '日用品',
    confidence: 0.8,
    ...overrides,
  };
}

describe('buildFromAiRows(N3「スクショから記録」の後段検証)', () => {
  it('正常な行を候補に変換する', () => {
    const result = buildFromAiRows([row()]);
    expect(result.candidates).toEqual([
      {
        occurredOn: '2026-09-29',
        amountYen: 1200,
        storeName: 'Amazon',
        genreHint: '日用品',
        confidence: 0.8,
      },
    ]);
  });

  it('複数の通知が1枚に写っていれば複数件を返す', () => {
    const result = buildFromAiRows([row({ amount_yen: 500 }), row({ amount_yen: 800 })]);
    expect(result.candidates).toHaveLength(2);
  });

  it('日付が不正な行は除いて警告する', () => {
    const result = buildFromAiRows([row({ occurred_on: '不明' })]);
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it('金額0の行は除く', () => {
    const result = buildFromAiRows([row({ amount_yen: 0 })]);
    expect(result.candidates).toEqual([]);
  });

  it('店名が空でもgenreHintがnullでも候補にはなる', () => {
    const result = buildFromAiRows([row({ store_name: '', genre_hint: '' })]);
    expect(result.candidates?.[0]).toMatchObject({ storeName: '', genreHint: null });
  });
});
