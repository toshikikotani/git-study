import { describe, expect, it } from 'vitest';

import {
  applyConflict,
  draftHasInput,
  emptyManualValues,
  initialValuesFor,
  itemsBar,
  judgeReadResult,
  mergeRescan,
  needsManualInput,
  parseDraft,
  toParsedReceipt,
  validateManualEntry,
  type ManualEntryValues,
} from '../../src/domain/receipt-capture';
import type { ParsedReceiptTransaction } from '../../src/features/import/receipt-ai';

const TODAY = '2026-09-29';

const parsed = (over: Partial<ParsedReceiptTransaction> = {}): ParsedReceiptTransaction => ({
  occurredOn: '2026-09-28',
  description: 'ファミリーマート 梅田店',
  amountYen: -1280,
  paymentMethod: 'unknown',
  items: [],
  expenseSubtype: null,
  storeName: 'ファミリーマート',
  fieldConfidence: { store: 0.9, date: 0.9, total: 0.9 },
  ...over,
});

describe('読み取り結果の判定(receiptStatus)', () => {
  it('何も読めない(明細が空)→ failed、全項目が未読', () => {
    const j = judgeReadResult([]);
    expect(j.receiptStatus).toBe('failed');
    expect(j.unreadFields).toEqual(['amountYen', 'occurredOn', 'storeName']);
    expect(needsManualInput(j.receiptStatus)).toBe(true);
  });

  it('全部読めた → parsed(入力待ちにならない)', () => {
    const j = judgeReadResult([parsed()]);
    expect(j.receiptStatus).toBe('parsed');
    expect(needsManualInput(j.receiptStatus)).toBe(false);
    expect(j.readFields).toEqual({
      amountYen: 1280,
      occurredOn: '2026-09-28',
      storeName: 'ファミリーマート',
    });
  });

  it('日付の確信度が低い → partial。読めた金額・店名は残り、日付だけ未読', () => {
    const j = judgeReadResult([parsed({ fieldConfidence: { store: 0.9, date: 0.2, total: 0.9 } })]);
    expect(j.receiptStatus).toBe('partial');
    expect(j.unreadFields).toEqual(['occurredOn']);
    expect(j.readFields.amountYen).toBe(1280);
    expect(j.readFields.occurredOn).toBeUndefined();
  });

  it('金額が0・全項目の確信度が低い → failed', () => {
    const j = judgeReadResult([
      parsed({
        amountYen: 0,
        storeName: '',
        description: '',
        fieldConfidence: { store: 0.1, date: 0.1, total: 0.1 },
      }),
    ]);
    expect(j.receiptStatus).toBe('failed');
  });

  it('複数の買い物が写っているときは従来どおり確認画面へ(parsed)', () => {
    expect(judgeReadResult([parsed(), parsed()]).receiptStatus).toBe('parsed');
  });
});

describe('手入力フォーム', () => {
  it('読めた項目だけ初期値に入り、読めなかった項目は空(推測で埋めない)', () => {
    const v = initialValuesFor({ amountYen: 980 }, TODAY, 'acc');
    expect(v.amountYen).toBe(980);
    expect(v.storeName).toBe('');
    expect(v.accountId).toBe('acc');
  });

  it('金額・日付・口座が無いと保存できない。店名は空でも保存できる', () => {
    const e = validateManualEntry(emptyManualValues(TODAY), TODAY);
    expect(e.amountYen).toBeDefined();
    expect(e.accountId).toBeDefined();
    expect(e.occurredOn).toBeUndefined();
    const ok = validateManualEntry({ ...emptyManualValues(TODAY, 'acc'), amountYen: 500 }, TODAY);
    expect(ok).toEqual({});
    expect(
      validateManualEntry(
        { ...emptyManualValues(TODAY, 'acc'), amountYen: 500, occurredOn: '2028-01-01' },
        TODAY,
      ).occurredOn,
    ).toBeDefined();
  });

  it('保存する形:金額は負(支出)、店名なしは「レシート(手入力)」', () => {
    const p = toParsedReceipt({ ...emptyManualValues(TODAY, 'acc'), amountYen: 500 });
    expect(p.amountYen).toBe(-500);
    expect(p.description).toBe('レシート(手入力)');
    expect(p.items).toEqual([]);
  });
});

describe('品目と照合バー(税率8%/10%)', () => {
  const items = [
    { id: 'a', name: 'おにぎり', amountYen: 216, taxRate: 8 as const },
    { id: 'b', name: '袋', amountYen: 3, taxRate: 10 as const },
  ];
  it('合計が一致(±1円は端数として吸収)', () => {
    expect(itemsBar(items, 219).status).toBe('ok');
    expect(itemsBar(items, 220).status).toBe('ok');
    expect(itemsBar(items, 230)).toMatchObject({ status: 'short', diffYen: 11 });
    expect(itemsBar(items, 200)).toMatchObject({ status: 'over', diffYen: -19 });
  });
  it('税率ごとの税込合計と内税額', () => {
    const bar = itemsBar(items, 219);
    expect(bar.byRate.map((g) => [g.rate, g.grossYen, g.taxYen])).toEqual([
      [8, 216, 16],
      [10, 3, 0],
    ]);
  });
  it('品目が空なら照合しない。合計が一致するときだけ品目を保存に含める', () => {
    expect(itemsBar([], 500).status).toBe('empty');
    const base = { ...emptyManualValues(TODAY, 'acc'), amountYen: 219, items };
    expect(toParsedReceipt(base).items).toHaveLength(2);
    expect(toParsedReceipt({ ...base, amountYen: 500 }).items).toEqual([]);
  });
});

describe('再読み取りは入力中の値を上書きしない', () => {
  const values: ManualEntryValues = {
    ...emptyManualValues(TODAY, 'acc'),
    amountYen: 1000,
    storeName: '',
  };
  it('空欄は自動で埋め、入力済みで食い違う項目は差分として返す(値は変えない)', () => {
    const r = mergeRescan(
      values,
      new Set(['amountYen']),
      { amountYen: 1280, storeName: 'ローソン', occurredOn: '2026-09-27' },
      TODAY,
    );
    expect(r.values.amountYen).toBe(1000); // 入力済みは書き換えない
    expect(r.values.storeName).toBe('ローソン');
    expect(r.values.occurredOn).toBe('2026-09-27'); // 日付は触っていない(既定の今日)ので埋める
    expect(r.filled).toEqual(['occurredOn', 'storeName']);
    expect(r.conflicts).toEqual([{ field: 'amountYen', current: '1000', rescanned: '1280' }]);
  });
  it('触った日付は書き換えない', () => {
    const r = mergeRescan(values, new Set(['occurredOn']), { occurredOn: '2026-09-01' }, TODAY);
    expect(r.values.occurredOn).toBe(TODAY);
    expect(r.conflicts[0]?.field).toBe('occurredOn');
  });
  it('差分を「置き換える」で採用できる', () => {
    expect(
      applyConflict(values, { field: 'amountYen', current: '1000', rescanned: '1280' }).amountYen,
    ).toBe(1280);
  });
});

describe('下書き', () => {
  it('保存した形から復元でき、壊れた値は捨てる', () => {
    const v = { ...emptyManualValues(TODAY, 'acc'), amountYen: 300, storeName: 'X' };
    expect(parseDraft({ values: v, touched: ['amountYen', 'bogus'] })).toEqual({
      values: v,
      touched: ['amountYen'],
    });
    expect(parseDraft('x')).toBeNull();
    expect(parseDraft({ values: 1 })).toBeNull();
  });
  it('何も入力していない下書きは保存しない', () => {
    expect(draftHasInput(emptyManualValues(TODAY))).toBe(false);
    expect(draftHasInput({ ...emptyManualValues(TODAY), memo: 'メモ' })).toBe(true);
  });
});
