import { describe, expect, it, vi } from 'vitest';

import { buildFromAiRows, type AiEmailExtractor } from '@/features/import/email-ai';
import { StaticMailSource, syncFromMailbox } from '@/features/import/mail-sync';
import type { RawMessage } from '@/features/import/mailbox';
import type { EmailParseResult } from '@/features/import/email';
import type { ClassificationRule } from '@/features/classification/rules';

/**
 * AI 抽出の後段(ADR-019)。
 *
 * モデルの出力そのものは検証できない(呼ぶたびに変わりうる)。
 * 検証すべきは「モデルが何を返してきても、こちらが正しく扱うか」なので、
 * 返答を固定した偽の抽出器を渡して、後段の判断だけを試す。
 */

describe('buildFromAiRows — モデルの出力を信用しきらない', () => {
  it('読み取れた行を明細にする', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 3500,
        description: 'ローソン渋谷',
        payment_method_text: '1回払い',
      },
    ]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      occurredOn: '2026-09-03',
      description: 'ローソン渋谷',
      amountYen: -3500,
      paymentMethod: 'one_time',
    });
  });

  it('モデルが正の金額を返しても支出(負)にする', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 1200,
        description: '書店',
        payment_method_text: '',
      },
    ]);
    expect(result.transactions[0]!.amountYen).toBe(-1200);
  });

  it('リボの判定はモデルではなく正規表現が行う(ADR-010)', () => {
    // モデルが「リボ払い」をそのまま写してきた場合
    const written = buildFromAiRows([
      {
        occurred_on: '2026-09-05',
        amount_yen: 12800,
        description: 'AMAZON',
        payment_method_text: 'リボ払い',
      },
    ]);
    expect(written.transactions[0]!.paymentMethod).toBe('revolving');
  });

  it('モデルが支払方法を言い換えてきても、判定は文字列だけを見る', () => {
    // 「revolving」と英訳して返してきた場合でも検知できる
    const translated = buildFromAiRows([
      {
        occurred_on: '2026-09-05',
        amount_yen: 12800,
        description: 'AMAZON',
        payment_method_text: 'revolving',
      },
    ]);
    expect(translated.transactions[0]!.paymentMethod).toBe('revolving');

    // 逆に、モデルが勝手に判定名を付けても、本文にその語が無ければ従わない。
    // ここで 'one_time' になるのは「1回払い」という文字列を読んだからであって、
    // モデルが「これは一括だ」と述べたからではない。
    const asWritten = buildFromAiRows([
      {
        occurred_on: '2026-09-05',
        amount_yen: 500,
        description: 'コンビニ',
        payment_method_text: '1回払い',
      },
    ]);
    expect(asWritten.transactions[0]!.paymentMethod).toBe('one_time');
  });

  it('解釈できない日付の行は理由を残して捨てる', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '来週の火曜',
        amount_yen: 500,
        description: 'コンビニ',
        payment_method_text: '',
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
        description: 'コンビニ',
        payment_method_text: '',
      },
    ]);
    expect(result.transactions).toEqual([]);
    expect(result.warnings[0]).toMatch(/大きすぎる/);
  });

  it('金額が 0 の行は捨てる', () => {
    const result = buildFromAiRows([
      { occurred_on: '2026-09-03', amount_yen: 0, description: '', payment_method_text: '' },
    ]);
    expect(result.transactions).toEqual([]);
    expect(result.warnings).not.toEqual([]);
  });

  it('小数で返ってきた金額は円に丸める', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 3500.4,
        description: '書店',
        payment_method_text: '',
      },
    ]);
    expect(result.transactions[0]!.amountYen).toBe(-3500);
  });

  it('店名が空なら不明として残す(行ごと捨てない)', () => {
    const result = buildFromAiRows([
      {
        occurred_on: '2026-09-03',
        amount_yen: 500,
        description: '   ',
        payment_method_text: '',
      },
    ]);
    expect(result.transactions[0]!.description).toBe('(店名不明)');
  });

  it('1件も無ければ理由を残す', () => {
    const result = buildFromAiRows([]);
    expect(result.transactions).toEqual([]);
    expect(result.warnings).not.toEqual([]);
  });
});

describe('syncFromMailbox — AI は読めなかったときだけ呼ぶ', () => {
  const RULES: ClassificationRule[] = [
    {
      id: 'd1',
      name: 'リボ払いの検知',
      priority: 1,
      matchType: 'regex',
      pattern: '(リボ|ﾘﾎﾞ)',
      setPaymentMethod: 'revolving',
      isActive: true,
    },
  ];

  /** 辞書が知っている書式。AI に回るべきではない。 */
  const KNOWN: RawMessage = {
    messageId: 'known',
    from: 'info@rakuten-card.co.jp',
    subject: 'カード利用のお知らせ',
    receivedOn: '2026-09-03',
    body: 'ご利用日: 2026/09/03\nご利用先: ローソン渋谷\nご利用金額: 3,500円\n支払方法: 1回払い',
  };

  /** 辞書の語彙に無いラベルの書式。ここが AI の出番。 */
  const UNKNOWN: RawMessage = {
    messageId: 'unknown',
    from: 'notice@newcard.example',
    subject: 'お知らせ',
    receivedOn: '2026-09-04',
    body: '2026年9月4日にセブンイレブンで800円のお支払い(リボ払い)がありました。',
  };

  function fakeExtractor(result: EmailParseResult): AiEmailExtractor & { calls: number } {
    const extractor = {
      calls: 0,
      async extract(): Promise<EmailParseResult> {
        extractor.calls += 1;
        return result;
      },
    };
    return extractor;
  }

  const base = {
    rules: RULES,
    knownMessageIds: new Set<string>(),
    knownFingerprints: new Set<string>(),
    batchId: 'b1',
    query: { since: '2026-09-01' },
  };

  it('辞書で読めたメールでは AI を呼ばない(通常運転の費用はゼロ)', async () => {
    const extractor = fakeExtractor({ transactions: [], warnings: [] });
    const result = await syncFromMailbox({
      ...base,
      source: new StaticMailSource([KNOWN]),
      ai: { extractor, maxCalls: 10 },
    });

    expect(extractor.calls).toBe(0);
    expect(result.aiCallCount).toBe(0);
    expect(result.transactions).toHaveLength(1);
  });

  it('辞書で読めなかったメールを AI が救済する', async () => {
    const extractor = fakeExtractor({
      transactions: [
        {
          occurredOn: '2026-09-04',
          description: 'セブンイレブン',
          amountYen: -800,
          paymentMethod: 'revolving',
        },
      ],
      warnings: [],
    });
    const result = await syncFromMailbox({
      ...base,
      source: new StaticMailSource([UNKNOWN]),
      ai: { extractor, maxCalls: 10 },
    });

    expect(extractor.calls).toBe(1);
    expect(result.aiCallCount).toBe(1);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({ amountYen: -800, paymentMethod: 'revolving' });
  });

  it('AI を設定していなければ呼ばれず、辞書の結果だけが返る', async () => {
    const result = await syncFromMailbox({ ...base, source: new StaticMailSource([UNKNOWN]) });
    expect(result.aiCallCount).toBe(0);
    expect(result.transactions).toEqual([]);
    expect(result.warnings).not.toEqual([]);
  });

  it('1回の取り込みで AI を呼ぶ回数に上限を置く(費用が青天井にならない)', async () => {
    const extractor = fakeExtractor({ transactions: [], warnings: ['読めませんでした'] });
    const many: RawMessage[] = Array.from({ length: 5 }, (_, i) => ({
      ...UNKNOWN,
      messageId: `unknown-${i}`,
    }));

    const result = await syncFromMailbox({
      ...base,
      source: new StaticMailSource(many),
      ai: { extractor, maxCalls: 2 },
    });

    expect(extractor.calls).toBe(2);
    expect(result.aiCallCount).toBe(2);
  });

  it('AI も読めなければ、辞書側の理由も併せて残す', async () => {
    const extractor = fakeExtractor({ transactions: [], warnings: ['AI も読み取れませんでした'] });
    const result = await syncFromMailbox({
      ...base,
      source: new StaticMailSource([UNKNOWN]),
      ai: { extractor, maxCalls: 10 },
    });

    const messages = result.warnings.map((w) => w.message);
    expect(messages).toContain('AI も読み取れませんでした');
    expect(messages.length).toBeGreaterThan(1);
  });

  it('AI が落ちても取り込み全体は止まらない', async () => {
    const failing: AiEmailExtractor = {
      async extract() {
        return { transactions: [], warnings: ['AI の呼び出しに失敗しました'] };
      },
    };
    const result = await syncFromMailbox({
      ...base,
      source: new StaticMailSource([KNOWN, UNKNOWN]),
      ai: { extractor: failing, maxCalls: 10 },
    });

    // 辞書で読めた方は残る
    expect(result.transactions).toHaveLength(1);
    expect(result.warnings.some((w) => w.messageId === 'unknown')).toBe(true);
  });

  it('AI が救済した明細も重複排除の対象になる(CSV と二重にならない)', async () => {
    const extracted = {
      occurredOn: '2026-09-04' as const,
      description: 'セブンイレブン',
      amountYen: -800,
      paymentMethod: 'revolving' as const,
    };
    const extractor = fakeExtractor({ transactions: [extracted], warnings: [] });

    const first = await syncFromMailbox({
      ...base,
      source: new StaticMailSource([UNKNOWN]),
      ai: { extractor, maxCalls: 10 },
    });
    const second = await syncFromMailbox({
      ...base,
      source: new StaticMailSource([UNKNOWN]),
      ai: { extractor, maxCalls: 10 },
      knownFingerprints: new Set(first.transactions.map((t) => t.fingerprint)),
    });

    expect(second.transactions).toEqual([]);
    expect(second.duplicateCount).toBe(1);
  });
});

describe('ClaudeEmailExtractor — 失敗を握り潰さない', () => {
  it('API が失敗しても例外を投げず、理由を warnings に残す', async () => {
    const { ClaudeEmailExtractor } = await import('@/features/import/email-ai');
    const client = {
      messages: { parse: vi.fn().mockRejectedValue(new Error('接続できません')) },
    };
    const extractor = new ClaudeEmailExtractor('sk-ant-test', client as never);

    const result = await extractor.extract({ body: 'なにか' });
    expect(result.transactions).toEqual([]);
    expect(result.warnings[0]).toMatch(/失敗/);
  });

  it('利用通知でないと判断されたら明細を作らない', async () => {
    const { ClaudeEmailExtractor } = await import('@/features/import/email-ai');
    const client = {
      messages: {
        parse: vi.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          parsed_output: { is_card_notification: false, transactions: [] },
        }),
      },
    };
    const extractor = new ClaudeEmailExtractor('sk-ant-test', client as never);

    const result = await extractor.extract({ body: 'キャンペーンのお知らせ' });
    expect(result.transactions).toEqual([]);
    expect(result.warnings).not.toEqual([]);
  });

  it('出力が途中で切れたら、部分的な結果を採用しない', async () => {
    const { ClaudeEmailExtractor } = await import('@/features/import/email-ai');
    const client = {
      messages: {
        parse: vi.fn().mockResolvedValue({ stop_reason: 'max_tokens', parsed_output: null }),
      },
    };
    const extractor = new ClaudeEmailExtractor('sk-ant-test', client as never);

    const result = await extractor.extract({ body: '長いメール' });
    expect(result.transactions).toEqual([]);
    expect(result.warnings[0]).toMatch(/切れ/);
  });
});
