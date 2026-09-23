import { describe, expect, it, vi } from 'vitest';

import { buildFromAiRows, itemsReconcileWithTotal } from '@/features/import/receipt-ai';

/**
 * AI 抽出の後段(ADR-021)。email-ai.test.ts と同じ考え方:
 * モデルの出力そのものは検証できないので、返答を固定した状態で
 * 「モデルが何を返してきても、こちらが正しく扱うか」だけを検証する。
 */

describe('buildFromAiRows(receipt) — モデルの出力を信用しきらない', () => {
  it('読み取れた行を明細にする', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 780,
        store_name: 'ローソン渋谷店',
        payment_method_text: '現金',
        items: [],
        expense_subtype: '',
      },
    ]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      occurredOn: '2026-09-03',
      description: 'ローソン渋谷店',
      amountYen: -780,
      paymentMethod: 'unknown',
    });
  });

  it('モデルが正の金額を返しても支出(負)にする', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 1200,
        store_name: '書店',
        payment_method_text: '',
        items: [],
        expense_subtype: '',
      },
    ]);
    expect(result.transactions[0]!.amountYen).toBe(-1200);
  });

  it('リボ・分割の判定はモデルではなく正規表現が行う(ADR-010)', () => {
    const written = buildFromAiRows([
      {
        occurred_on: '2026-09-05',
        amount_yen: 12800,
        store_name: '家電量販店',
        payment_method_text: '5回払い',
        items: [],
        expense_subtype: '',
      },
    ]);
    expect(written.transactions[0]!.paymentMethod).toBe('installment');
  });

  it('解釈できない日付の行は理由を残して捨てる', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '来週の火曜',
        amount_yen: 500,
        store_name: 'コンビニ',
        payment_method_text: '',
        items: [],
        expense_subtype: '',
      },
    ]);
    expect(result.transactions).toEqual([]);
    expect(result.warnings[0]).toMatch(/日付/);
  });

  it('桁を外した金額は本人に見せる前に止める', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 3_500_000_000,
        store_name: 'コンビニ',
        payment_method_text: '',
        items: [],
        expense_subtype: '',
      },
    ]);
    expect(result.transactions).toEqual([]);
    expect(result.warnings[0]).toMatch(/大きすぎる/);
  });

  it('金額が 0 の行は捨てる', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 0,
        store_name: '',
        payment_method_text: '',
        items: [],
        expense_subtype: '',
      },
    ]);
    expect(result.transactions).toEqual([]);
    expect(result.warnings).not.toEqual([]);
  });

  it('小数で返ってきた金額は円に丸める', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 780.6,
        store_name: '書店',
        payment_method_text: '',
        items: [],
        expense_subtype: '',
      },
    ]);
    expect(result.transactions[0]!.amountYen).toBe(-781);
  });

  it('店名が空なら不明として残す(行ごと捨てない)', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 500,
        store_name: '   ',
        payment_method_text: '',
        items: [],
        expense_subtype: '',
      },
    ]);
    expect(result.transactions[0]!.description).toBe('(店名不明)');
  });

  it('1件も無ければ理由を残す', () => {
    const result = buildFromAiRows([]);
    expect(result.transactions).toEqual([]);
    expect(result.warnings).not.toEqual([]);
  });

  it('商品行の合計が支払合計と一致すれば items を返す(本人発案)', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 780,
        store_name: 'スーパー',
        payment_method_text: '',
        items: [
          { name: 'おにぎり', amount_yen: 150, product_type: '' },
          { name: '洗剤', amount_yen: 630, product_type: '' },
        ],
        expense_subtype: '',
      },
    ]);
    expect(result.transactions[0]!.items).toEqual([
      { description: 'おにぎり', amountYen: -150, productType: null },
      { description: '洗剤', amountYen: -630, productType: null },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('商品行の合計が支払合計と一致しなくても items は返す(本人発案「レシートは店と品目を合わせた概念」、ADR-034)', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 780,
        store_name: 'スーパー',
        payment_method_text: '',
        items: [
          { name: 'おにぎり', amount_yen: 150, product_type: '' },
          { name: '洗剤', amount_yen: 999, product_type: '' },
        ],
        expense_subtype: '',
      },
    ]);
    expect(result.transactions[0]!.items).toEqual([
      { description: 'おにぎり', amountYen: -150, productType: null },
      { description: '洗剤', amountYen: -999, productType: null },
    ]);
    expect(result.transactions).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it('商品が1点だけ(内訳なし)でも items として返す(ADR-034)', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 500,
        store_name: 'コンビニ',
        payment_method_text: '',
        items: [{ name: 'コーヒー', amount_yen: 500, product_type: '' }],
        expense_subtype: '',
      },
    ]);
    expect(result.transactions[0]!.items).toEqual([
      { description: 'コーヒー', amountYen: -500, productType: null },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('品名が空の商品行は「(品名不明)」として残す', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 500,
        store_name: 'スーパー',
        payment_method_text: '',
        items: [
          { name: '  ', amount_yen: 300, product_type: '' },
          { name: '洗剤', amount_yen: 200, product_type: '' },
        ],
        expense_subtype: '',
      },
    ]);
    expect(result.transactions[0]!.items).toEqual([
      { description: '(品名不明)', amountYen: -300, productType: null },
      { description: '洗剤', amountYen: -200, productType: null },
    ]);
  });

  it('金額が0の商品行は除いて、残りは items として返す', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 500,
        store_name: 'スーパー',
        payment_method_text: '',
        items: [
          { name: 'サンプル', amount_yen: 0, product_type: '' },
          { name: '洗剤', amount_yen: 200, product_type: '' },
        ],
        expense_subtype: '',
      },
    ]);
    expect(result.transactions[0]!.items).toEqual([
      { description: '洗剤', amountYen: -200, productType: null },
    ]);
  });

  it('1枚に複数の明細が写っていればすべて返す', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 500,
        store_name: 'コンビニA',
        payment_method_text: '',
        items: [],
        expense_subtype: '',
      },
      {
        occurred_on: '2026-09-03',
        amount_yen: 1200,
        store_name: 'コンビニB',
        payment_method_text: '',
        items: [],
        expense_subtype: '',
      },
    ]);
    expect(result.transactions).toHaveLength(2);
  });

  it('商品の種類(product_type)を読み取れれば商品ごとに残す(本人発案、ADR-036)', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 780,
        store_name: 'スーパー',
        payment_method_text: '',
        items: [
          { name: '緑茶', amount_yen: 150, product_type: '飲料' },
          { name: '柔軟剤', amount_yen: 630, product_type: '  日用品  ' },
        ],
        expense_subtype: '',
      },
    ]);
    expect(result.transactions[0]!.items).toEqual([
      { description: '緑茶', amountYen: -150, productType: '飲料' },
      { description: '柔軟剤', amountYen: -630, productType: '日用品' },
    ]);
  });

  it('生活費の小分類(expense_subtype)を読み取れれば保持し、空文字は null にする(本人発案、ADR-036)', () => {
    const withSubtype = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 3200,
        store_name: 'スーパー',
        payment_method_text: '',
        items: [],
        expense_subtype: '  食費  ',
      },
    ]);
    expect(withSubtype.transactions[0]!.expenseSubtype).toBe('食費');

    const withoutSubtype = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 3200,
        store_name: '証券会社',
        payment_method_text: '',
        items: [],
        expense_subtype: '',
      },
    ]);
    expect(withoutSubtype.transactions[0]!.expenseSubtype).toBeNull();
  });
});

describe('ClaudeReceiptExtractor — 失敗を握り潰さない', () => {
  it('API が失敗しても例外を投げず、理由を warnings に残す', async () => {
    const { ClaudeReceiptExtractor } = await import('@/features/import/receipt-ai');
    const client = {
      messages: { parse: vi.fn().mockRejectedValue(new Error('接続できません')) },
    };
    const extractor = new ClaudeReceiptExtractor('sk-ant-test', client as never);

    const result = await extractor.extract({ imageBase64: 'AAA', mediaType: 'image/jpeg' });
    expect(result.transactions).toEqual([]);
    expect(result.warnings[0]).toMatch(/失敗/);
  });

  it('レシート・領収書でないと判断されたら明細を作らない', async () => {
    const { ClaudeReceiptExtractor } = await import('@/features/import/receipt-ai');
    const client = {
      messages: {
        parse: vi.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 },
          parsed_output: { is_receipt: false, transactions: [] },
        }),
      },
    };
    const extractor = new ClaudeReceiptExtractor('sk-ant-test', client as never);

    const result = await extractor.extract({ imageBase64: 'AAA', mediaType: 'image/jpeg' });
    expect(result.transactions).toEqual([]);
    expect(result.warnings).not.toEqual([]);
  });

  it('出力が途中で切れたら、部分的な結果を採用しない', async () => {
    const { ClaudeReceiptExtractor } = await import('@/features/import/receipt-ai');
    const client = {
      messages: {
        parse: vi.fn().mockResolvedValue({
          stop_reason: 'max_tokens',
          parsed_output: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
      },
    };
    const extractor = new ClaudeReceiptExtractor('sk-ant-test', client as never);

    const result = await extractor.extract({ imageBase64: 'AAA', mediaType: 'image/jpeg' });
    expect(result.transactions).toEqual([]);
    expect(result.warnings[0]).toMatch(/切れ/);
  });

  it('読み取れたら画像を渡してモデルを呼ぶ', async () => {
    const { ClaudeReceiptExtractor } = await import('@/features/import/receipt-ai');
    const parse = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
      parsed_output: {
        is_receipt: true,
        transactions: [
          {
            occurred_on: '2026-09-03',
            amount_yen: 500,
            store_name: 'コンビニ',
            payment_method_text: '',
            items: [],
            expense_subtype: '',
          },
        ],
      },
    });
    const extractor = new ClaudeReceiptExtractor('sk-ant-test', { messages: { parse } } as never);

    const result = await extractor.extract({ imageBase64: 'AAA', mediaType: 'image/png' });

    expect(result.transactions).toHaveLength(1);
    const call = parse.mock.calls[0]![0] as {
      messages: Array<{ content: Array<{ type: string; source?: { media_type: string } }> }>;
    };
    const imageBlock = call.messages[0]!.content.find((c) => c.type === 'image');
    expect(imageBlock?.source?.media_type).toBe('image/png');
  });
});

describe('itemsReconcileWithTotal — カテゴリ分割の対象になるか(ADR-034)', () => {
  it('2件以上あり合計が一致すれば true', () => {
    const items = [
      { description: 'おにぎり', amountYen: -150, productType: null },
      { description: '洗剤', amountYen: -630, productType: null },
    ];
    expect(itemsReconcileWithTotal(items, -780)).toBe(true);
  });

  it('合計が一致しなければ false(品目としては別に保存する)', () => {
    const items = [
      { description: 'おにぎり', amountYen: -150, productType: null },
      { description: '洗剤', amountYen: -999, productType: null },
    ];
    expect(itemsReconcileWithTotal(items, -780)).toBe(false);
  });

  it('1件だけなら合計が一致していても false', () => {
    const items = [{ description: 'コーヒー', amountYen: -500, productType: null }];
    expect(itemsReconcileWithTotal(items, -500)).toBe(false);
  });
});
