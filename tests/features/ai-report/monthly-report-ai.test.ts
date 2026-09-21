import { describe, expect, it } from 'vitest';

import { buildFromAiOutput } from '@/features/ai-report/monthly-report-ai';

/**
 * AI月次レポートの後段(ADR-031)。diagnosis-ai.test.ts と同じ考え方:モデルの
 * 出力そのものは検証できないので、返答を固定した状態で「モデルが何を返して
 * きてもこちらが正しく扱うか」だけを検証する。
 */

function validRow(overrides: Partial<Parameters<typeof buildFromAiOutput>[0]> = {}) {
  return {
    personaType: 'steady' as const,
    personaReasoning: '予算内に収まる支出が多く、大きな逸脱がないため。',
    insights: ['食費が予算を3,000円超過しました。', '浪費比率は先月から5ポイント改善しました。'],
    advice: ['固定費の見直しを月1回のペースで続けましょう。'],
    ...overrides,
  };
}

describe('buildFromAiOutput(monthly report) — モデルの出力を信用しきらない', () => {
  it('正常な出力をそのまま返す', () => {
    const result = buildFromAiOutput(validRow());
    expect(result.report).toEqual({
      personaType: 'steady',
      personaReasoning: '予算内に収まる支出が多く、大きな逸脱がないため。',
      insights: ['食費が予算を3,000円超過しました。', '浪費比率は先月から5ポイント改善しました。'],
      advice: ['固定費の見直しを月1回のペースで続けましょう。'],
    });
    expect(result.warnings).toEqual([]);
  });

  it('personaReasoning が空文字なら失敗として扱う', () => {
    const result = buildFromAiOutput(validRow({ personaReasoning: '   ' }));
    expect(result.report).toBeNull();
    expect(result.warnings).toHaveLength(1);
  });

  it('insights が空配列なら失敗として扱う', () => {
    const result = buildFromAiOutput(validRow({ insights: [] }));
    expect(result.report).toBeNull();
  });

  it('advice が空文字だけの配列なら失敗として扱う', () => {
    const result = buildFromAiOutput(validRow({ advice: ['  ', ''] }));
    expect(result.report).toBeNull();
  });

  it('空文字の要素だけ取り除いて残りは採用する', () => {
    const result = buildFromAiOutput(
      validRow({ insights: ['有効な気づき', '  ', ''], advice: ['有効な助言', ''] }),
    );
    expect(result.report?.insights).toEqual(['有効な気づき']);
    expect(result.report?.advice).toEqual(['有効な助言']);
  });

  it('件数が多すぎる場合は5件に切る', () => {
    const many = Array.from({ length: 8 }, (_, i) => `気づき${i}`);
    const result = buildFromAiOutput(validRow({ insights: many, advice: many }));
    expect(result.report?.insights).toHaveLength(5);
    expect(result.report?.advice).toHaveLength(5);
  });
});
