import { describe, expect, it } from 'vitest';

import { buildFromAiRows } from '@/features/import/natural-text-ai';

function row(overrides: Partial<Parameters<typeof buildFromAiRows>[0][number]> = {}) {
  return {
    occurred_on: '2026-09-29',
    amount_yen: 350,
    store_name: 'ローソン',
    genre_hint: '食費',
    confidence: 0.9,
    ...overrides,
  };
}

describe('buildFromAiRows(N3「文字で記録」の後段検証)', () => {
  it('正常な行をそのまま候補に変換する', () => {
    const result = buildFromAiRows([row()]);
    expect(result.candidates).toEqual([
      {
        occurredOn: '2026-09-29',
        amountYen: 350,
        storeName: 'ローソン',
        genreHint: '食費',
        confidence: 0.9,
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('複数の取引をすべて変換する(1つの文に複数の買い物)', () => {
    const result = buildFromAiRows([
      row({ store_name: 'ローソン', amount_yen: 150 }),
      row({ store_name: 'ローソン', amount_yen: 200 }),
    ]);
    expect(result.candidates).toHaveLength(2);
  });

  it('日付が解釈できない行は除いて警告を積む', () => {
    const result = buildFromAiRows([row({ occurred_on: '来週' })]);
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it('金額が0の行は除く', () => {
    const result = buildFromAiRows([row({ amount_yen: 0 })]);
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it('金額の絶対値を取り、整数に丸める', () => {
    const result = buildFromAiRows([row({ amount_yen: -150.4 })]);
    expect(result.candidates?.[0]?.amountYen).toBe(150);
  });

  it('店名・ジャンルが空文字ならnullに正規化する(genreHint)', () => {
    const result = buildFromAiRows([row({ genre_hint: '' })]);
    expect(result.candidates?.[0]?.genreHint).toBeNull();
  });

  it('confidence を0〜1に丸める', () => {
    const result = buildFromAiRows([row({ confidence: 1.5 })]);
    expect(result.candidates?.[0]?.confidence).toBe(1);
  });

  it('上限を超える金額は除く', () => {
    const result = buildFromAiRows([row({ amount_yen: 20_000_000 })]);
    expect(result.candidates).toEqual([]);
  });

  it('空配列を渡すと空配列を返す', () => {
    const result = buildFromAiRows([]);
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
