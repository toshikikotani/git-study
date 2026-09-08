import { describe, expect, it, vi } from 'vitest';

import {
  applyConfidenceThreshold,
  ClaudeTransactionClassifier,
  type AiClassification,
  type CategoryOption,
} from '@/features/classification/ai';

/**
 * ルール漏れの明細を拾う AI 分類の後段(M2-4)。
 *
 * モデルの出力そのものは検証できないので、返答を固定した偽の client を渡して、
 * 「モデルが何を返してきても、こちらが正しく扱うか」だけを試す。
 */

const CATEGORIES: CategoryOption[] = [
  { code: 'living', name: '生活費' },
  { code: 'waste', name: '浪費' },
];

function fakeClient(parse: ReturnType<typeof vi.fn>) {
  return { messages: { parse } } as never;
}

describe('ClaudeTransactionClassifier — 失敗を握り潰さない', () => {
  it('API が失敗しても例外を投げず、理由を warnings に残す', async () => {
    const parse = vi.fn().mockRejectedValue(new Error('接続できません'));
    const classifier = new ClaudeTransactionClassifier('sk-ant-test', fakeClient(parse));

    const result = await classifier.classifyMany(
      [{ id: 't1', description: 'ローソン', merchantName: null, amountYen: -500 }],
      CATEGORIES,
    );
    expect(result.classifications).toEqual([]);
    expect(result.warnings[0]).toMatch(/失敗/);
  });

  it('出力が途中で切れたら、部分的な結果を採用しない', async () => {
    const parse = vi.fn().mockResolvedValue({
      stop_reason: 'max_tokens',
      parsed_output: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const classifier = new ClaudeTransactionClassifier('sk-ant-test', fakeClient(parse));

    const result = await classifier.classifyMany(
      [{ id: 't1', description: 'ローソン', merchantName: null, amountYen: -500 }],
      CATEGORIES,
    );
    expect(result.classifications).toEqual([]);
    expect(result.warnings[0]).toMatch(/切れ/);
  });

  it('返答件数が入力と一致しなければ、当て推量で対応付けない', async () => {
    const parse = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { classifications: [{ category_code: 'living', confidence: 0.9 }] },
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const classifier = new ClaudeTransactionClassifier('sk-ant-test', fakeClient(parse));

    const result = await classifier.classifyMany(
      [
        { id: 't1', description: 'ローソン', merchantName: null, amountYen: -500 },
        { id: 't2', description: 'セブン', merchantName: null, amountYen: -300 },
      ],
      CATEGORIES,
    );
    expect(result.classifications).toEqual([]);
    expect(result.warnings[0]).toMatch(/件数/);
  });

  it('選択肢に無い code を返してきたら、分類できなかった扱いにする', async () => {
    const parse = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { classifications: [{ category_code: 'unknown_code', confidence: 0.9 }] },
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const classifier = new ClaudeTransactionClassifier('sk-ant-test', fakeClient(parse));

    const result = await classifier.classifyMany(
      [{ id: 't1', description: 'ローソン', merchantName: null, amountYen: -500 }],
      CATEGORIES,
    );
    expect(result.classifications[0]).toMatchObject({
      transactionId: 't1',
      categoryCode: null,
      confidence: 0.9,
    });
  });

  it('該当なしは空文字で返ってくる想定で、null に変換する', async () => {
    const parse = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { classifications: [{ category_code: '', confidence: 0.2 }] },
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const classifier = new ClaudeTransactionClassifier('sk-ant-test', fakeClient(parse));

    const result = await classifier.classifyMany(
      [{ id: 't1', description: '謎の店', merchantName: null, amountYen: -500 }],
      CATEGORIES,
    );
    expect(result.classifications[0]!.categoryCode).toBeNull();
  });

  it('正しく分類できた行はそのまま返す', async () => {
    const parse = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { classifications: [{ category_code: 'living', confidence: 0.95 }] },
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const classifier = new ClaudeTransactionClassifier('sk-ant-test', fakeClient(parse));

    const result = await classifier.classifyMany(
      [{ id: 't1', description: 'ローソン', merchantName: 'ローソン渋谷', amountYen: -500 }],
      CATEGORIES,
    );
    expect(result.classifications).toEqual([
      { transactionId: 't1', categoryCode: 'living', confidence: 0.95 },
    ]);
  });

  it('100件を送ると、既定のバッチサイズで3リクエスト以内に収まる', async () => {
    const parse = vi.fn().mockImplementation(async (req) => {
      const count = (req.messages[0].content.match(/\d+\. 摘要:/g) ?? []).length;
      return {
        stop_reason: 'end_turn',
        parsed_output: {
          classifications: Array.from({ length: count }, () => ({
            category_code: 'living',
            confidence: 0.8,
          })),
        },
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    });
    const classifier = new ClaudeTransactionClassifier('sk-ant-test', fakeClient(parse));

    const transactions = Array.from({ length: 100 }, (_, i) => ({
      id: `t${i}`,
      description: 'ローソン',
      merchantName: null,
      amountYen: -500,
    }));
    const result = await classifier.classifyMany(transactions, CATEGORIES);

    expect(result.requestCount).toBeLessThanOrEqual(3);
    expect(result.classifications).toHaveLength(100);
  });

  it('1バッチが失敗しても、他のバッチは続行する', async () => {
    const parse = vi
      .fn()
      .mockRejectedValueOnce(new Error('一時的な失敗'))
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        parsed_output: { classifications: [{ category_code: 'living', confidence: 0.9 }] },
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    const classifier = new ClaudeTransactionClassifier('sk-ant-test', fakeClient(parse));

    const transactions = Array.from({ length: 41 }, (_, i) => ({
      id: `t${i}`,
      description: 'ローソン',
      merchantName: null,
      amountYen: -500,
    }));
    const result = await classifier.classifyMany(transactions, CATEGORIES, { batchSize: 40 });

    expect(result.requestCount).toBe(2);
    expect(result.classifications).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  it('対象が0件ならリクエストを送らない', async () => {
    const parse = vi.fn();
    const classifier = new ClaudeTransactionClassifier('sk-ant-test', fakeClient(parse));

    const result = await classifier.classifyMany([], CATEGORIES);
    expect(parse).not.toHaveBeenCalled();
    expect(result.classifications).toEqual([]);
    expect(result.requestCount).toBe(0);
  });
});

describe('applyConfidenceThreshold — 「AI がどう思ったか」と「信用するか」の境界', () => {
  function classification(overrides: Partial<AiClassification> = {}): AiClassification {
    return { transactionId: 't1', categoryCode: 'living', confidence: 0.9, ...overrides };
  }

  it('閾値以上なら自動確定扱い', () => {
    const result = applyConfidenceThreshold(classification({ confidence: 0.8 }), 0.7);
    expect(result).toMatchObject({
      categoryCode: 'living',
      classifiedBy: 'ai',
      reviewStatus: 'auto_ok',
    });
  });

  it('閾値未満でも分類自体は ai のまま、確認待ちに回す', () => {
    const result = applyConfidenceThreshold(classification({ confidence: 0.4 }), 0.7);
    expect(result).toMatchObject({
      categoryCode: 'living',
      classifiedBy: 'ai',
      reviewStatus: 'pending',
    });
  });

  it('categoryCode が null なら unclassified として確認待ちに回す', () => {
    const result = applyConfidenceThreshold(
      classification({ categoryCode: null, confidence: 0.9 }),
      0.7,
    );
    expect(result).toMatchObject({
      categoryCode: null,
      classifiedBy: 'unclassified',
      reviewStatus: 'pending',
    });
  });

  it('閾値ちょうどは自動確定扱い(境界値)', () => {
    const result = applyConfidenceThreshold(classification({ confidence: 0.7 }), 0.7);
    expect(result.reviewStatus).toBe('auto_ok');
  });
});
