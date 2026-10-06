import { describe, expect, it } from 'vitest';

import {
  EMPTY_FILTER,
  buildAttention,
  buildListModel,
  filterLedger,
  rowSubtitle,
  splitShares,
} from '@/features/spending/views';
import { ledgerSplit, ledgerTx } from '../../helpers/ledger';

const TODAY = '2026-09-29';

const txs = [
  ledgerTx({
    id: 'a',
    occurredOn: '2026-09-28',
    label: 'ココカラファイン',
    branchName: '阪神大阪梅田駅店',
    genreId: 'drug',
    genreName: '日用品',
    amountYen: -3000,
    splits: [
      ledgerSplit({ genreId: 'drug', genreName: '日用品', amountYen: -1200 }),
      ledgerSplit({ genreId: 'cafe', genreName: 'カフェ・飲料', amountYen: -1800 }),
    ],
  }),
  ledgerTx({
    id: 'b',
    occurredOn: '2026-09-28',
    label: 'ローソン',
    genreId: null,
    genreName: null,
    amountYen: -400,
  }),
  ledgerTx({
    id: 'c',
    occurredOn: '2026-09-27',
    label: '一蘭',
    amountYen: -1500,
    reconcileDiffYen: -150,
  }),
  ledgerTx({
    id: 'd',
    occurredOn: '2026-10-03',
    label: '発表会',
    genreId: 'event',
    amountYen: -26540,
    kind: 'special',
  }),
  ledgerTx({
    id: 'e',
    occurredOn: '2026-09-27',
    label: '給与',
    genreId: null,
    genreName: null,
    amountYen: 200000,
  }),
];

describe('buildListModel(明細リスト)', () => {
  const model = buildListModel(txs, TODAY);

  it('日付ごとに新しい順、日別合計はその日の使った額(収入は含めない)', () => {
    expect(model.dayGroups.map((g) => [g.date, g.spentYen])).toEqual([
      ['2026-09-28', 3400],
      ['2026-09-27', 1500],
    ]);
  });

  it('未来日の取引は「予定」に分ける(日別合計・実績に入れない)', () => {
    expect(model.scheduled.map((t) => t.id)).toEqual(['d']);
    expect(model.dayGroups.some((g) => g.date === '2026-10-03')).toBe(false);
  });
});

describe('filterLedger', () => {
  it('ジャンルで絞る(分割の子のジャンルも見る)/未分類/日付/検索', () => {
    expect(filterLedger(txs, { ...EMPTY_FILTER, genreId: 'cafe' }).map((t) => t.id)).toEqual(['a']);
    expect(filterLedger(txs, { ...EMPTY_FILTER, genreId: 'none' }).map((t) => t.id)).toEqual([
      'b',
      'e',
    ]);
    expect(filterLedger(txs, { ...EMPTY_FILTER, date: '2026-09-27' }).map((t) => t.id)).toEqual([
      'c',
      'e',
    ]);
    expect(filterLedger(txs, { ...EMPTY_FILTER, search: 'ｺｺｶﾗ' }).map((t) => t.id)).toEqual(['a']);
    expect(filterLedger(txs, { ...EMPTY_FILTER, search: '梅田' }).map((t) => t.id)).toEqual(['a']);
  });

  it('品目名でも検索でき、目標期間で絞れる', () => {
    const withItems = txs.map((t) =>
      t.id === 'c' ? { ...t, items: [{ name: 'チャーシュー麺' }] } : t,
    );
    expect(
      filterLedger(withItems, { ...EMPTY_FILTER, search: 'チャーシュー' }).map((t) => t.id),
    ).toEqual(['c']);
    expect(
      filterLedger(txs, { ...EMPTY_FILTER, range: { from: '2026-09-28', to: '2026-09-30' } }).map(
        (t) => t.id,
      ),
    ).toEqual(['a', 'b']);
  });
});

describe('splitShares / rowSubtitle', () => {
  it('分割した明細はジャンル比率(大きい順)、分割なしは空', () => {
    expect(splitShares(txs[0]!).map((s) => [s.genreName, Math.round(s.ratio * 100)])).toEqual([
      ['カフェ・飲料', 60],
      ['日用品', 40],
    ]);
    expect(splitShares(txs[1]!)).toEqual([]);
  });

  it('2行目は支店名 + 品目のプレビュー', () => {
    expect(rowSubtitle(txs[0]!, ['ラテ', 'ハンドクリーム', 'メモ帳', '電池'])).toBe(
      '阪神大阪梅田駅店 ・ ラテ、ハンドクリーム、メモ帳 ほか1点',
    );
    expect(rowSubtitle(txs[1]!, [])).toBe('');
  });
});

describe('buildAttention(要確認)', () => {
  it('未分類と金額不一致の件数・金額(実績の支出のみ)', () => {
    const a = buildAttention(txs, TODAY);
    expect(a.uncategorized).toMatchObject({ count: 1, yen: 400, ids: ['b'] });
    expect(a.mismatch).toMatchObject({ count: 1, yen: 150, ids: ['c'] });
  });

  it('対象が無ければ 0 件', () => {
    const a = buildAttention(
      [txs[2]!].map((t) => ({ ...t, reconcileDiffYen: null })),
      TODAY,
    );
    expect(a.uncategorized.count + a.mismatch.count).toBe(0);
  });
});
