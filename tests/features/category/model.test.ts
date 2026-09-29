import { describe, expect, it } from 'vitest';

import { monthRange, summarizeLedger } from '../../../src/domain/ledger';
import {
  actualSpentYen,
  aggregateItems,
  aggregateStores,
  buildCategoryLines,
  categorySpentFromLedger,
  groupLinesByDay,
  scheduledYen,
  type CategoryTx,
} from '../../../src/features/category/model';
import { buildLedgerViews, toLedgerEntries } from '../../../src/features/spending/views';
import { ledgerSplit, ledgerTx } from '../../helpers/ledger';

const TODAY = '2026-09-29';
const RANGE = monthRange('2026-09');
const genres = [
  { id: 'dining', name: '外食', budget_yen: 20000 },
  { id: 'cafe', name: 'カフェ・飲料', budget_yen: null },
  { id: 'hobby', name: '娯楽・趣味', budget_yen: 30000 },
];

const tx = (o: Parameters<typeof ledgerTx>[0], items: CategoryTx['items'] = []): CategoryTx => ({
  ...ledgerTx(o),
  items,
});
const item = (id: string, name: string, amountYen: number, genreId: string | null = null) => ({
  id,
  name,
  amountYen,
  genreId,
  genreName: null,
  productType: null,
});

/** 家計簿と同じ表示のための、テスト用の明細セット。 */
const txs: CategoryTx[] = [
  tx({
    id: 'a',
    occurredOn: '2026-09-05',
    label: 'ココカラファイン',
    genreId: 'dining',
    amountYen: -1200,
  }),
  tx({
    id: 'b',
    occurredOn: '2026-09-05',
    label: 'ココカラファイン',
    genreId: 'dining',
    amountYen: -800,
  }),
  tx({ id: 'c', occurredOn: '2026-09-12', label: 'ローソン', genreId: 'dining', amountYen: -500 }),
  // 分割したレシート:外食 1,000 + カフェ 2,000(レシート全体 3,000)
  tx({
    id: 'd',
    occurredOn: '2026-09-20',
    label: 'ドトール',
    genreId: 'dining',
    amountYen: -3000,
    splits: [
      ledgerSplit({ genreId: 'dining', genreName: '外食', amountYen: -1000 }),
      ledgerSplit({ genreId: 'cafe', genreName: 'カフェ・飲料', amountYen: -2000 }),
    ],
  }),
  // 返品・返金(正の額、外食から差し引く)
  tx({
    id: 'r',
    occurredOn: '2026-09-21',
    label: 'ローソン',
    genreId: 'dining',
    amountYen: 300,
    kind: 'refund',
  }),
  // 予定(未来日)
  tx({
    id: 'f',
    occurredOn: '2026-09-30',
    label: '打ち上げ',
    genreId: 'dining',
    amountYen: -5000,
    status: 'scheduled',
  }),
  // 別カテゴリ・収入・入力待ち
  tx({ id: 'h', occurredOn: '2026-09-08', label: '映画', genreId: 'hobby', amountYen: -1800 }),
  tx({
    id: 'i',
    occurredOn: '2026-09-25',
    label: '給与',
    genreId: null,
    genreName: null,
    amountYen: 250000,
  }),
  tx({
    id: 'n',
    occurredOn: '2026-09-26',
    label: '入力待ち',
    genreId: 'dining',
    amountYen: -9999,
    needsInput: true,
  }),
];

describe('P5 返品・返金は、収入ではなく同じジャンルの支出から差し引く', () => {
  it('summarizeLedger:ジャンル別・日別・使った額がすべて純額になる。収入には入らない', () => {
    const s = summarizeLedger(toLedgerEntries(txs.filter((t) => !t.needsInput)), RANGE, TODAY);
    // 外食: 1200+800+500+1000 − 300(返金)
    expect(s.byGenre.get('dining')).toBe(3200);
    expect(s.byDay.get('2026-09-21')).toBe(-300);
    expect(s.incomeYen).toBe(250000); // 給与だけ。返金は入らない
    expect(s.spentYen).toBe(3200 + 2000 + 1800);
    expect(s.byGenrePace.get('dining')).toBe(3200);
  });

  it('返品でない正の額(ジャンル付きの収入)は、これまでどおり収入', () => {
    const s = summarizeLedger(
      toLedgerEntries([tx({ id: 'x', genreId: 'dining', amountYen: 4000 })]),
      RANGE,
      TODAY,
    );
    expect(s.incomeYen).toBe(4000);
    expect(s.byGenre.get('dining')).toBeUndefined();
  });
});

describe('P5 取引・品目・店の3つの見方は、合計が家計簿のジャンル内訳と一致する(受け入れ基準2・3)', () => {
  const lines = buildCategoryLines(txs, 'dining', RANGE, TODAY);
  const views = buildLedgerViews({ genres, transactions: txs, range: RANGE, today: TODAY });
  const breakdownYen = views.genreBreakdown.find((r) => r.genreId === 'dining')!.spentYen;

  it('家計簿のジャンル内訳(buildLedgerViews)と、カテゴリの合計が一致する', () => {
    expect(breakdownYen).toBe(3200);
    expect(actualSpentYen(lines)).toBe(breakdownYen);
    expect(categorySpentFromLedger(txs, 'dining', RANGE, TODAY)).toBe(breakdownYen);
  });

  it('取引(日付ごと)・品目・店の合計が、すべて同じ', () => {
    const days = groupLinesByDay(lines).reduce((a, g) => a + g.spentYen, 0);
    const items = aggregateItems(lines, 'dining').reduce((a, i) => a + i.totalYen, 0);
    const stores = aggregateStores(lines).reduce((a, s) => a + s.totalYen, 0);
    expect(days).toBe(breakdownYen);
    expect(items).toBe(breakdownYen);
    expect(stores).toBe(breakdownYen);
  });

  it('入力待ち・収入・別カテゴリは含まない。予定は実績の合計に入らず、別に持つ', () => {
    expect(lines.map((l) => l.txId).sort()).toEqual(['a', 'b', 'c', 'd', 'f', 'r']);
    expect(scheduledYen(lines)).toBe(5000);
    expect(lines.find((l) => l.txId === 'n')).toBeUndefined();
  });

  it('未分類(none)のカテゴリも同じ性質', () => {
    const more = [
      ...txs,
      tx({ id: 'u1', genreId: null, genreName: null, amountYen: -700, occurredOn: '2026-09-11' }),
    ];
    const l = buildCategoryLines(more, 'none', RANGE, TODAY);
    const v = buildLedgerViews({ genres, transactions: more, range: RANGE, today: TODAY });
    expect(actualSpentYen(l)).toBe(700);
    expect(v.genreBreakdown.find((r) => r.genreId === null)?.spentYen).toBe(700);
  });
});

describe('P5 分割したレシート(受け入れ基準4)', () => {
  const lines = buildCategoryLines(txs, 'dining', RANGE, TODAY);
  const cafeLines = buildCategoryLines(txs, 'cafe', RANGE, TODAY);

  it('このカテゴリに属する品目の金額だけが表示され、レシート全体の額が添えられる', () => {
    const d = lines.find((l) => l.txId === 'd')!;
    expect(d.amountYen).toBe(-1000);
    expect(d.receiptTotalYen).toBe(3000);
    const c = cafeLines.find((l) => l.txId === 'd')!;
    expect(c.amountYen).toBe(-2000);
    expect(c.receiptTotalYen).toBe(3000);
    // 分割でない明細には「レシート全体」は付かない
    expect(lines.find((l) => l.txId === 'a')!.receiptTotalYen).toBeNull();
  });

  it('返品は合計から差し引かれ、正の額(緑の「+」)として行に出る', () => {
    const r = lines.find((l) => l.txId === 'r')!;
    expect(r.refund).toBe(true);
    expect(r.amountYen).toBe(300);
    expect(actualSpentYen(lines)).toBe(1200 + 800 + 500 + 1000 - 300);
  });
});

describe('P5 品目・店の集計', () => {
  it('品目は名前の表記ゆれ(全半角・大文字小文字・空白)をまとめ、回数・合計・平均を出す。足りないぶんは「品目の記録なし」', () => {
    const t = [
      tx(
        {
          id: 'p1',
          occurredOn: '2026-09-01',
          label: 'ファミリーマート',
          genreId: 'cafe',
          genreName: 'カフェ・飲料',
          amountYen: -230,
        },
        [item('i1', "TULLY'S ブラック", -130, 'cafe'), item('i2', 'おにぎり', -100, 'cafe')],
      ),
      tx(
        {
          id: 'p2',
          occurredOn: '2026-09-02',
          label: 'ローソン',
          genreId: 'cafe',
          genreName: 'カフェ・飲料',
          amountYen: -180,
        },
        [item('i3', 'ＴＵＬＬＹ’Ｓ ブラック', -150, 'cafe')],
      ),
      tx({
        id: 'p3',
        occurredOn: '2026-09-03',
        label: 'ローソン',
        genreId: 'cafe',
        genreName: 'カフェ・飲料',
        amountYen: -400,
      }),
    ];
    const lines = buildCategoryLines(t, 'cafe', RANGE, TODAY);
    const items = aggregateItems(lines, 'cafe');
    const tully = items.find((i) => i.name.includes('TULLY') || i.name.includes('ＴＵＬＬＹ'))!;
    expect(tully.count).toBe(2);
    expect(tully.totalYen).toBe(280);
    expect(tully.averageYen).toBe(140);
    const none = items.find((i) => i.name === '品目の記録なし')!;
    expect(none.totalYen).toBe(30 + 400); // p2 の残り 30円 + p3 の 400円
    expect(items.reduce((a, i) => a + i.totalYen, 0)).toBe(230 + 180 + 400);
  });

  it('店は表記ゆれをまとめ、金額の多い順。回数・平均・最後に行った日を出す', () => {
    const t = [
      tx({ id: 's1', occurredOn: '2026-09-02', label: 'ローソン', amountYen: -500 }),
      tx({ id: 's2', occurredOn: '2026-09-09', label: 'ﾛｰｿﾝ', amountYen: -700 }),
      tx({ id: 's3', occurredOn: '2026-09-05', label: 'ドトール', amountYen: -2000 }),
    ];
    const stores = aggregateStores(buildCategoryLines(t, 'dining', RANGE, TODAY));
    expect(stores.map((s) => s.label)).toEqual([
      'ドトール',
      expect.stringMatching(/ローソン|ﾛｰｿﾝ/),
    ]);
    const lawson = stores[1]!;
    expect(lawson.count).toBe(2);
    expect(lawson.totalYen).toBe(1200);
    expect(lawson.averageYen).toBe(600);
    expect(lawson.lastOn).toBe('2026-09-09');
  });
});

describe('P5 性質:どんなデータでも3つの見方の合計が一致する', () => {
  it('ランダムな1,000件(分割・返品・予定・品目つき)でも一致', () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const names = ['ローソン', 'ファミリーマート', 'ドトール', 'ココカラファイン', 'セブン'];
    const itemNames = ['ブラック', 'おにぎり', 'お茶', 'パン', '牛乳'];
    const gen = ['dining', 'cafe', 'hobby'];
    const many: CategoryTx[] = [];
    for (let i = 0; i < 1000; i++) {
      const day = 1 + Math.floor(rnd() * 28);
      const amount = -(100 + Math.floor(rnd() * 3000));
      const g = gen[Math.floor(rnd() * 3)]!;
      const kind = rnd() < 0.05 ? 'refund' : 'normal';
      const isSplit = rnd() < 0.2;
      const its = Array.from({ length: Math.floor(rnd() * 4) }, (_, k) =>
        item(
          `i${i}-${k}`,
          itemNames[Math.floor(rnd() * 5)]!,
          -Math.floor((rnd() * Math.abs(amount)) / 3),
          rnd() < 0.5 ? g : null,
        ),
      );
      many.push(
        tx(
          {
            id: `t${i}`,
            occurredOn: `2026-09-${String(day).padStart(2, '0')}`,
            label: names[Math.floor(rnd() * 5)]!,
            genreId: g,
            amountYen: kind === 'refund' ? Math.abs(amount) : amount,
            kind,
            ...(isSplit && kind !== 'refund'
              ? {
                  splits: [
                    ledgerSplit({ genreId: g, amountYen: Math.round(amount / 2) }),
                    ledgerSplit({ genreId: 'hobby', amountYen: amount - Math.round(amount / 2) }),
                  ],
                }
              : {}),
          },
          its,
        ),
      );
    }
    for (const g of gen) {
      const lines = buildCategoryLines(many, g, RANGE, TODAY);
      const ledger = categorySpentFromLedger(many, g, RANGE, TODAY);
      expect(actualSpentYen(lines)).toBe(ledger);
      expect(groupLinesByDay(lines).reduce((a, x) => a + x.spentYen, 0)).toBe(ledger);
      expect(aggregateItems(lines, g).reduce((a, x) => a + x.totalYen, 0)).toBe(ledger);
      expect(aggregateStores(lines).reduce((a, x) => a + x.totalYen, 0)).toBe(ledger);
    }
  });
});
