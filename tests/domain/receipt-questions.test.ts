import { describe, expect, it } from 'vitest';

import {
  askFor,
  bandOf,
  orderQuestions,
  parseCheckLevel,
  totalConfidence,
  type QuestionField,
} from '@/domain/receipt-questions';

/**
 * レシートの確認で何を聞くか(v5 変更5、ADR-133)。痛さと自信で「必ず聞く・聞く・聞かない」を決め、
 * 「必ず聞く」から自信の低い順に1つずつ。
 */
describe('自信の分け方', () => {
  it('自信あり ≥ 0.9、少し不安 0.7〜0.9、自信なし < 0.7。返ってこなければ自信あり', () => {
    expect(bandOf(0.95)).toBe('sure');
    expect(bandOf(0.9)).toBe('sure');
    expect(bandOf(0.89)).toBe('unsure');
    expect(bandOf(0.7)).toBe('unsure');
    expect(bandOf(0.69)).toBe('doubt');
    expect(bandOf(undefined)).toBe('sure');
    expect(bandOf(null)).toBe('sure');
  });

  it('品目の合計と合計が合えば、合計は自信ありに上げる', () => {
    expect(totalConfidence(0.4, true)).toBe(1);
    expect(totalConfidence(0.4, false)).toBe(0.4);
  });
});

describe('ふつうの表', () => {
  const row = (field: QuestionField, ctx = {}) =>
    (['sure', 'unsure', 'doubt'] as const).map((band) => askFor(field, band, 'normal', ctx));

  it('カテゴリ・合計:聞かない / 聞く / 必ず聞く', () => {
    expect(row('category')).toEqual(['skip', 'ask', 'must']);
    expect(row('total')).toEqual(['skip', 'ask', 'must']);
  });

  it('日付:聞かない / 聞く(期をまたぐなら必ず)/ 必ず聞く', () => {
    expect(row('date')).toEqual(['skip', 'ask', 'must']);
    expect(row('date', { crossesPeriod: true })).toEqual(['skip', 'must', 'must']);
  });

  it('支払い・お店:自信なしのときだけ聞く', () => {
    expect(row('account')).toEqual(['skip', 'skip', 'ask']);
    expect(row('store')).toEqual(['skip', 'skip', 'ask']);
  });

  it('品目:自信なしで、合計と合わないときだけ聞く', () => {
    expect(row('item')).toEqual(['skip', 'skip', 'skip']);
    expect(row('item', { itemsMismatch: true })).toEqual(['skip', 'skip', 'ask']);
  });
});

describe('確かめる細かさ', () => {
  it('しっかり:少し不安なものも必ず聞く', () => {
    expect(askFor('store', 'unsure', 'thorough')).toBe('must');
    expect(askFor('account', 'unsure', 'thorough')).toBe('must');
    expect(askFor('category', 'sure', 'thorough')).toBe('skip');
  });

  it('少なめ:必ず聞くのは、自信なしのカテゴリと自信なしの合計だけ。ほかは聞かない', () => {
    expect(askFor('category', 'doubt', 'light')).toBe('must');
    expect(askFor('total', 'doubt', 'light')).toBe('must');
    expect(askFor('category', 'unsure', 'light')).toBe('skip');
    expect(askFor('date', 'doubt', 'light', { crossesPeriod: true })).toBe('skip');
    expect(askFor('account', 'doubt', 'light')).toBe('skip');
    expect(askFor('store', 'doubt', 'light')).toBe('skip');
  });

  it('設定の値が読めなければ「ふつう」', () => {
    expect(parseCheckLevel('thorough')).toBe('thorough');
    expect(parseCheckLevel('light')).toBe('light');
    expect(parseCheckLevel('???')).toBe('normal');
    expect(parseCheckLevel(undefined)).toBe('normal');
  });
});

describe('聞く順番', () => {
  it('スギ薬局の例:プロテインバーのカテゴリ(0.3)→ 日付(0.62)→ 支払い(初めてのカード)', () => {
    const ordered = orderQuestions(
      [
        { id: 'account', field: 'account', confidence: 0.4 },
        { id: 'date', field: 'date', confidence: 0.62 },
        { id: 'store', field: 'store', confidence: 0.95 },
        { id: 'category:protein', field: 'category', confidence: 0.3 },
        { id: 'total', field: 'total', confidence: 1 },
      ],
      'normal',
    );
    expect(ordered.map((q) => q.id)).toEqual(['category:protein', 'date', 'account']);
    expect(ordered.map((q) => q.ask)).toEqual(['must', 'must', 'ask']);
  });

  it('自信が同じくらいなら、痛いほうを先に聞く', () => {
    const ordered = orderQuestions(
      [
        { id: 'store', field: 'store', confidence: 0.61 },
        { id: 'total', field: 'total', confidence: 0.62 },
      ],
      'thorough',
    );
    expect(ordered.map((q) => q.id)).toEqual(['total', 'store']);
  });

  it('聞かないものは並べない', () => {
    expect(orderQuestions([{ id: 'store', field: 'store', confidence: 0.99 }], 'normal')).toEqual(
      [],
    );
  });
});
