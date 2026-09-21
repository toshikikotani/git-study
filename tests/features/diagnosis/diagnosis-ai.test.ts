import { describe, expect, it } from 'vitest';

import { buildFromAiRows, type SpendingDiagnosisInput } from '@/features/diagnosis/diagnosis-ai';

/**
 * AI診断の後段(ADR-030)。receipt-ai.test.ts と同じ考え方:モデルの出力
 * そのものは検証できないので、返答を固定した状態で「モデルが何を返してきても
 * こちらが正しく扱うか」だけを検証する。
 */

function input(
  id: string,
  overrides: Partial<SpendingDiagnosisInput> = {},
): SpendingDiagnosisInput {
  return {
    id,
    label: 'カフェ',
    amountYen: -500,
    occurredOn: '2026-09-03',
    categoryName: '浪費',
    ...overrides,
  };
}

describe('buildFromAiRows(diagnosis) — モデルの出力を信用しきらない', () => {
  it('要求した明細に対する判断をそのまま返す', () => {
    const requested = [input('tx-1')];
    const result = buildFromAiRows(
      [{ id: 'tx-1', verdict: 'waste', reasoning: '生活に必須ではない嗜好品への支出' }],
      requested,
    );
    expect(result.results).toEqual([
      { id: 'tx-1', verdict: 'waste', reasoning: '生活に必須ではない嗜好品への支出' },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('要求していない id(モデルの捏造)は無視する', () => {
    const requested = [input('tx-1')];
    const result = buildFromAiRows(
      [
        { id: 'tx-1', verdict: 'necessary', reasoning: '通院のための交通費' },
        { id: 'tx-does-not-exist', verdict: 'waste', reasoning: 'でっちあげ' },
      ],
      requested,
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.id).toBe('tx-1');
  });

  it('同じ id が重複していれば最初の1件だけ採用する', () => {
    const requested = [input('tx-1')];
    const result = buildFromAiRows(
      [
        { id: 'tx-1', verdict: 'waste', reasoning: '最初の判断' },
        { id: 'tx-1', verdict: 'necessary', reasoning: '2回目の判断' },
      ],
      requested,
    );
    expect(result.results).toEqual([{ id: 'tx-1', verdict: 'waste', reasoning: '最初の判断' }]);
  });

  it('理由が空文字の行は捨てる', () => {
    const requested = [input('tx-1')];
    const result = buildFromAiRows([{ id: 'tx-1', verdict: 'waste', reasoning: '  ' }], requested);
    expect(result.results).toEqual([]);
  });

  it('要求した件数より少なく返ってきた場合、警告を1件返す', () => {
    const requested = [input('tx-1'), input('tx-2')];
    const result = buildFromAiRows(
      [{ id: 'tx-1', verdict: 'waste', reasoning: '理由' }],
      requested,
    );
    expect(result.results).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('1件');
  });

  it('要求した件数すべて返ってくれば警告は無い', () => {
    const requested = [input('tx-1'), input('tx-2')];
    const result = buildFromAiRows(
      [
        { id: 'tx-1', verdict: 'waste', reasoning: '理由1' },
        { id: 'tx-2', verdict: 'necessary', reasoning: '理由2' },
      ],
      requested,
    );
    expect(result.results).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });

  it('渡された明細が空なら何もしない', () => {
    const result = buildFromAiRows([], []);
    expect(result).toEqual({ results: [], warnings: [] });
  });
});
