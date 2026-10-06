import { describe, expect, it } from 'vitest';

import { buildFromAiOutput } from '@/features/ai-report/daily-report-ai';

/**
 * AI日次レポートの後段(ADR-032)。monthly-report-ai.test.ts と同じ考え方:
 * モデルの出力そのものは検証できないので、返答を固定した状態で「モデルが
 * 何を返してきてもこちらが正しく扱うか」だけを検証する。
 */

function validRow(overrides: Partial<Parameters<typeof buildFromAiOutput>[0]> = {}) {
  return {
    insights: ['今日の外食は今月の平均日額の2倍でした。'],
    advice: ['次に外食する前に、今月の残り予算を確認しましょう。'],
    ...overrides,
  };
}

describe('buildFromAiOutput(daily report) — モデルの出力を信用しきらない', () => {
  it('正常な出力をそのまま返す', () => {
    const result = buildFromAiOutput(validRow());
    expect(result.report).toEqual({
      insights: ['今日の外食は今月の平均日額の2倍でした。'],
      advice: ['次に外食する前に、今月の残り予算を確認しましょう。'],
    });
    expect(result.warnings).toEqual([]);
  });

  it('insights が空配列なら失敗として扱う', () => {
    const result = buildFromAiOutput(validRow({ insights: [] }));
    expect(result.report).toBeNull();
    expect(result.warnings).toHaveLength(1);
  });

  it('advice が空文字だけの配列なら失敗として扱う', () => {
    const result = buildFromAiOutput(validRow({ advice: ['  ', ''] }));
    expect(result.report).toBeNull();
  });

  it('空文字の要素だけ取り除いて残りは採用する', () => {
    const result = buildFromAiOutput(
      validRow({ insights: ['有効な気づき', '  '], advice: ['有効な助言', ''] }),
    );
    expect(result.report?.insights).toEqual(['有効な気づき']);
    expect(result.report?.advice).toEqual(['有効な助言']);
  });

  it('件数が多すぎる場合は4件に切る', () => {
    const many = Array.from({ length: 6 }, (_, i) => `気づき${i}`);
    const result = buildFromAiOutput(validRow({ insights: many, advice: many }));
    expect(result.report?.insights).toHaveLength(4);
    expect(result.report?.advice).toHaveLength(4);
  });
});
