import { describe, expect, it } from 'vitest';

import { splitReadResult, parseReadyPayload, readyPayloadToRaw } from '@/domain/unsaved-receipt';
import {
  checkQuestions,
  checkSavePlan,
  genreCorrections,
  initialCheckState,
  isComplete,
  saveBlock,
  WHOLE,
  type CheckContext,
  type CheckState,
} from '@/features/import/receipt-check';
import { buildFromAiRows, type ExtractionRow } from '@/features/import/receipt-ai';
import { newJob } from '@/features/import/receipt-queue';
import { fromServer, mergeUnsavedReceipts } from '@/features/import/unsaved-receipts';
import type { ReadyReceiptView } from '@/features/receipt-captures/types';

/**
 * 保存前のレシートを確かめる画面の中身(v5 変更2・3・5、ADR-133)。
 */
const row = (o: Partial<ExtractionRow> = {}): ExtractionRow => ({
  occurred_on: '2026-10-22',
  amount_yen: 700,
  store_name: 'スギ薬局',
  payment_method_text: '',
  items: [
    {
      name: 'プロテインバー',
      amount_yen: 200,
      product_type: '',
      tax_rate: 8,
      is_discount: false,
      confidence: 1,
      y_ratio: 0.4,
    },
    {
      name: 'シャンプー',
      amount_yen: 500,
      product_type: '',
      tax_rate: 10,
      is_discount: false,
      confidence: 1,
      y_ratio: 0.5,
    },
  ],
  expense_subtype: '',
  price_basis: 'tax_included',
  tax_8_yen: 0,
  tax_10_yen: 0,
  points_used_yen: 0,
  coupon_yen: 0,
  store_confidence: 1,
  date_confidence: 1,
  total_confidence: 1,
  store_y_ratio: 0.05,
  date_y_ratio: 0.1,
  total_y_ratio: 0.8,
  card_last4: '',
  ...o,
});

function receipt(
  o: Partial<ExtractionRow> = {},
  classifications: ReadyReceiptView['classifications'] = [
    { key: '0:0', genreId: 'food', confidence: 0.95, source: 'history' },
    { key: '0:1', genreId: 'goods', confidence: 1, source: 'rule' },
  ],
  extra: Partial<ReadyReceiptView> = {},
) {
  const parsed = buildFromAiRows([row(o)]).transactions[0]!;
  return fromServer({
    id: 'cap-1',
    imageUrl: 'https://example.test/r.jpg',
    imagePath: 'u/r.jpg',
    capturedOn: '2026-10-23',
    createdAt: '2026-10-23T01:00:00Z',
    parsed,
    warnings: [],
    classifications,
    parentGenreId: 'goods',
    accountGuess: { accountId: 'cash', confidence: 1, reason: 'card' },
    ...extra,
  });
}
const ctx: CheckContext = { level: 'normal', goalRange: { from: '2026-10-01', to: '2026-10-31' } };

describe('そろっているレシートは問いが出ず、「保存」を押すだけで済む', () => {
  it('自信があり、品目の合計と合計が合っていれば、問いは0', () => {
    const r = receipt();
    const s = initialCheckState(r, 'cash');
    expect(checkQuestions(r, s, ctx)).toEqual([]);
    expect(saveBlock(r, s, [])).toBeNull();
    expect(isComplete(r, s, ctx)).toBe(true);
  });

  it('品目の合計と合計が合うと、合計の自信が低くても聞かない', () => {
    const r = receipt({ total_confidence: 0.3 });
    expect(checkQuestions(r, initialCheckState(r, 'cash'), ctx).map((q) => q.field)).not.toContain(
      'total',
    );
  });
});

describe('問いは「必ず聞く」から、自信の低い順に1つずつ', () => {
  it('スギ薬局の例:プロテインバーのカテゴリ(0.3)→ 日付(0.62)→ 支払い(初めてのカード)', () => {
    const r = receipt(
      { date_confidence: 0.62 },
      [
        { key: '0:0', genreId: 'goods', confidence: 0.3, source: 'ai' },
        { key: '0:1', genreId: 'goods', confidence: 1, source: 'rule' },
      ],
      { accountGuess: { accountId: 'cash', confidence: 0.4, reason: 'default' } },
    );
    const s = initialCheckState(r, 'cash');
    const qs = checkQuestions(r, s, ctx);
    expect(qs.map((q) => q.field)).toEqual(['category', 'date', 'account']);
    expect(qs.map((q) => q.ask)).toEqual(['must', 'must', 'ask']);
    // 自信なしのカテゴリは何も当てない(必ず選ぶ)。自信ありの品目は当てたまま。
    expect(s.genreByLineId.get('l0')).toBeNull();
    expect(s.genreByLineId.get('l1')).toBe('goods');
    // 問いのカードに画像のその部分を出す(品目は y_ratio、日付は date_y_ratio)
    expect(qs[0]!.yRatio).toBe(0.4);
    expect(qs[1]!.yRatio).toBe(0.1);
    // 日付の候補:読んだ日と撮った日
    expect(qs[1]!.field === 'date' && qs[1]!.candidates).toEqual(['2026-10-22', '2026-10-23']);
    expect(saveBlock(r, s, qs)).toBe('must');
  });

  it('答えた問いは出さない。答えると保存できる', () => {
    const r = receipt({}, [{ key: '0:0', genreId: 'food', confidence: 0.2, source: 'ai' }]);
    const s = initialCheckState(r, 'cash');
    const answered: CheckState = {
      ...s,
      genreByLineId: new Map([
        ['l0', 'food'],
        ['l1', 'goods'],
      ]),
      answered: new Set(['line:l0', 'line:l1']),
    };
    const qs = checkQuestions(r, answered, ctx);
    expect(qs).toEqual([]);
    expect(saveBlock(r, answered, qs)).toBeNull();
  });

  it('同じカテゴリが候補になった品目は、1問にまとめる', () => {
    const r = receipt({}, [
      { key: '0:0', genreId: 'goods', confidence: 0.75, source: 'history' },
      { key: '0:1', genreId: 'goods', confidence: 0.8, source: 'dictionary' },
    ]);
    const qs = checkQuestions(r, initialCheckState(r, 'cash'), ctx);
    expect(qs).toHaveLength(1);
    expect(qs[0]!.field === 'category' && qs[0]!.lineIds).toEqual(['l0', 'l1']);
    // 少し不安なら「聞く」(答えずに保存すると合っているとみなす)。おすすめは当ててある
    expect(qs[0]!.ask).toBe('ask');
  });

  it('カテゴリが空のままでは保存できない', () => {
    const r = receipt({}, []);
    const s = initialCheckState(r, 'cash');
    expect(s.genreByLineId.get('l0')).toBeNull();
    const qs = checkQuestions(r, { ...s, answered: new Set(['line:l0', 'line:l1']) }, ctx);
    expect(saveBlock(r, { ...s, answered: new Set(['line:l0', 'line:l1']) }, qs)).toBe('genre');
  });

  it('「少なめ」にすると、カテゴリと合計のほかは聞かれない', () => {
    const r = receipt(
      { date_confidence: 0.2, store_confidence: 0.2 },
      [
        { key: '0:0', genreId: 'food', confidence: 0.2, source: 'ai' },
        { key: '0:1', genreId: 'goods', confidence: 1, source: 'rule' },
      ],
      { accountGuess: { accountId: 'cash', confidence: 0.4, reason: 'default' } },
    );
    const qs = checkQuestions(r, initialCheckState(r, 'cash'), { ...ctx, level: 'light' });
    expect(qs.map((q) => q.field)).toEqual(['category']);
  });

  it('日付の候補が今期の目標の期間をまたぐなら、少し不安でも必ず聞く', () => {
    const r = receipt({ occurred_on: '2026-09-30', date_confidence: 0.8 });
    const qs = checkQuestions(r, initialCheckState(r, 'cash'), ctx);
    expect(qs.find((q) => q.field === 'date')?.ask).toBe('must');
  });
});

describe('品目のないレシート', () => {
  it('カテゴリの自信がなければ、明細そのもののカテゴリを必ず選ぶ', () => {
    const r = receipt({ items: [] }, [
      { key: '0', genreId: 'food', confidence: 0.3, source: 'ai' },
    ]);
    const s = initialCheckState(r, 'cash');
    expect(s.genreByLineId.get(WHOLE)).toBeNull();
    const qs = checkQuestions(r, s, ctx);
    expect(qs.map((q) => [q.field, q.ask])).toEqual([['category', 'must']]);
    expect(qs[0]!.field === 'category' && qs[0]!.lineIds).toEqual([WHOLE]);
    expect(isComplete(r, s, ctx)).toBe(false);
  });
});

describe('保存する形', () => {
  it('品目ごとのカテゴリで分け、支払いは選んだ口座', () => {
    const r = receipt();
    const plan = checkSavePlan(r, { ...initialCheckState(r, 'card'), accountId: 'card' }, 'ref-1');
    expect(plan.transaction.accountId).toBe('card');
    expect(plan.transaction.amountYen).toBe(-700);
    expect(plan.splits?.map((x) => x.genreId)).toEqual(['food', 'goods']);
  });

  it('品目のないレシートは、明細そのものにカテゴリを付ける', () => {
    const r = receipt({ items: [] }, [
      { key: '0', genreId: 'food', confidence: 1, source: 'rule' },
    ]);
    const s = initialCheckState(r, 'cash');
    expect(s.genreByLineId.get(WHOLE)).toBe('food');
    expect(checkSavePlan(r, s, 'ref-2').transaction.genreId).toBe('food');
  });

  it('直したカテゴリと「次から同じ品名は」をオンにしたものだけを履歴に入れる', () => {
    const r = receipt();
    const s = initialCheckState(r, 'cash');
    const edited: CheckState = {
      ...s,
      genreByLineId: new Map([
        ['l0', 'snack'],
        ['l1', 'goods'],
      ]),
      remember: new Set(['l1']),
    };
    expect(genreCorrections(r, edited)).toEqual([
      { itemName: 'プロテインバー', genreId: 'snack', pin: false },
      { itemName: 'シャンプー', genreId: 'goods', pin: true },
    ]);
  });
});

describe('保存前の受け渡し(閉じても消えない)', () => {
  it('1枚に2件写っていたら1件ずつに分け、品目のカテゴリの鍵を付け直す', () => {
    const parsed = buildFromAiRows([row(), row({ store_name: 'ローソン' })]).transactions;
    const split = splitReadResult({
      transactions: parsed,
      warnings: ['1行読めませんでした'],
      classifications: [
        { key: '0:1', genreId: 'goods', confidence: 1 },
        { key: '1:0', genreId: 'food', confidence: 0.9 },
      ],
      parentGenreIds: { 1: 'food' },
    });
    expect(split).toHaveLength(2);
    expect(split[0]!.warnings).toEqual(['1行読めませんでした']);
    expect(split[1]!.warnings).toEqual([]);
    expect(split[1]!.classifications).toEqual([{ key: '0:0', genreId: 'food', confidence: 0.9 }]);
    expect(split[1]!.parentGenreId).toBe('food');
    // DB に置いて読み戻しても同じ
    expect(parseReadyPayload(JSON.parse(JSON.stringify(readyPayloadToRaw(split[1]!))))).toEqual(
      split[1],
    );
    expect(parseReadyPayload({ transactions: [{ nope: true }] })).toBeNull();
  });

  it('サーバーの保存前と画面の中の読み取り結果を合わせる。同じものは重ねず、保存・捨てたものは出さない', () => {
    const server = receipt();
    const parsed = buildFromAiRows([row({ store_name: 'ローソン' })]).transactions;
    const kept = {
      ...newJob('job-1', 'blob:1', Date.parse('2026-10-23T02:00:00Z')),
      status: 'ready' as const,
      parsed,
      readyIds: ['cap-1'],
    };
    const local = {
      ...newJob('job-2', 'blob:2', Date.parse('2026-10-23T03:00:00Z')),
      status: 'ready' as const,
      parsed,
    };
    const view = {
      id: 'cap-1',
      imageUrl: null,
      imagePath: 'u/r.jpg',
      capturedOn: '2026-10-23',
      createdAt: '2026-10-23T01:00:00Z',
      parsed: server.parsed,
      warnings: [],
      classifications: [],
      parentGenreId: null,
      accountGuess: null,
    };
    const merged = mergeUnsavedReceipts([view], [kept, local]);
    expect(merged.map((r) => r.key)).toEqual(['cap-1', 'job-2:0']);
    expect(
      mergeUnsavedReceipts([view], [kept, local], new Set(['cap-1'])).map((r) => r.key),
    ).toEqual(['job-2:0']);
  });
});
