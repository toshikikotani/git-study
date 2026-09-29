import { describe, expect, it } from 'vitest';

import {
  buildItemDetail,
  flattenRows,
  searchLines,
  sparklinePoints,
  stickyHeaderFor,
} from '../../../src/features/category/list';
import {
  aggregateItems,
  buildCategoryLines,
  collectItemOccurrences,
  type CategoryTx,
} from '../../../src/features/category/model';
import { ScrollMemory, VirtualIndex } from '../../../src/lib/virtual';
import { ledgerTx } from '../../helpers/ledger';

const TODAY = '2026-09-29';
const RANGE = { from: '2026-09-01', to: '2026-09-30' };
let n = 0;
const item = (name: string, yen: number) => ({
  id: `i${++n}`,
  name,
  amountYen: -yen,
  genreId: 'cafe',
  genreName: null,
  productType: null,
});
const tx = (
  date: string,
  label: string,
  yen: number,
  items: CategoryTx['items'] = [],
  extra: Partial<Parameters<typeof ledgerTx>[0]> = {},
): CategoryTx => ({
  ...ledgerTx({
    id: `t${++n}`,
    occurredOn: date,
    label,
    genreId: 'cafe',
    amountYen: -yen,
    ...extra,
  }),
  items,
});

describe('P5 取引の一覧の並び・検索', () => {
  const txs = [
    tx('2026-09-05', 'ドトール', 500, [item('ブレンド', 500)], { branchName: '梅田店' }),
    tx('2026-09-05', 'ローソン', 130, [item("TULLY'S ブラック", 130)]),
    tx('2026-09-12', 'ファミリーマート', 300),
    tx('2026-09-20', 'ローソン', 200, [], { kind: 'refund', amountYen: 200 }),
    tx('2026-09-30', '打ち上げ', 3000, [], { status: 'scheduled' }),
  ];
  const lines = buildCategoryLines(txs, 'cafe', RANGE, TODAY);

  it('日付順:新しい日から、日付の見出し(その日の合計、返品は差し引く)+ 行。予定だけの日は「予定」', () => {
    const rows = flattenRows(lines, 'newest');
    const headers = rows.filter((r) => r.kind === 'header');
    expect(
      headers.map((h) => h.kind === 'header' && [h.date, h.spentYen, h.scheduledOnly]),
    ).toEqual([
      ['2026-09-30', 0, true],
      ['2026-09-20', -200, false],
      ['2026-09-12', 300, false],
      ['2026-09-05', 630, false],
    ]);
    expect(rows[0]!.kind).toBe('header');
    expect(rows.filter((r) => r.kind === 'line')).toHaveLength(5);
  });

  it('金額順:見出しなしで、金額の多い順(返品・返金は最後)', () => {
    const rows = flattenRows(lines, 'amount');
    expect(rows.every((r) => r.kind === 'line')).toBe(true);
    const amounts = rows.map((r) => (r.kind === 'line' ? r.line.amountYen : 0));
    expect(amounts).toEqual([-3000, -500, -300, -130, 200]);
  });

  it('カテゴリ内の検索:店名・支店名・品目名(全半角・大文字小文字を区別しない)', () => {
    expect(searchLines(lines, '梅田').map((l) => l.label)).toEqual(['ドトール']);
    expect(searchLines(lines, 'ｔｕｌｌｙ').map((l) => l.label)).toEqual(['ローソン']);
    expect(searchLines(lines, 'ローソン')).toHaveLength(2);
    expect(searchLines(lines, '')).toHaveLength(lines.length);
    expect(searchLines(lines, 'ないもの')).toEqual([]);
  });

  it('上部に固定する見出し:いま見えている先頭の行が属する日', () => {
    const rows = flattenRows(lines, 'newest');
    const firstLine = rows.findIndex(
      (r) => r.kind === 'line' && r.line.occurredOn === '2026-09-05',
    );
    const sticky = stickyHeaderFor(rows, firstLine + 1);
    expect(sticky?.kind === 'header' && sticky.date).toBe('2026-09-05');
    expect(stickyHeaderFor([], 0)).toBeNull();
  });
});

describe('P5 品目の詳細(受け入れ基準7):単価の推移と最安の店', () => {
  const t = [
    tx('2026-08-10', 'ローソン', 150, [item("TULLY'S ブラック", 150)]),
    tx('2026-09-01', 'ファミリーマート', 118, [item("TULLY'S ブラック", 118)]),
    tx('2026-09-08', 'ローソン', 160, [item("TULLY'S ブラック", 160)]),
    tx('2026-09-15', 'ファミリーマート', 122, [item("TULLY'S ブラック", 122)]),
  ];
  const history = buildCategoryLines(t, 'cafe', { from: '2026-03-01', to: '2026-09-30' }, TODAY);
  const items = aggregateItems(history, 'cafe');
  const tully = items.find((i) => i.name.includes('TULLY'))!;
  const occ = collectItemOccurrences(history, 'cafe').byKey.get(tully.key)!.occurrences;
  const detail = buildItemDetail(tully.name, occ);

  it('単価の推移は日付順の点。件数・平均が出る', () => {
    expect(detail.points.map((p) => [p.date, p.unitYen])).toEqual([
      ['2026-08-10', 150],
      ['2026-09-01', 118],
      ['2026-09-08', 160],
      ['2026-09-15', 122],
    ]);
    expect(detail.count).toBe(4);
    expect(detail.averageYen).toBe(Math.round((150 + 118 + 160 + 122) / 4));
  });

  it('店ごとの単価は安い順で、最安の店に印(ファミリーマート)。店が1つなら印は付けない', () => {
    expect(detail.stores.map((s) => [s.label, s.averageYen, s.cheapest])).toEqual([
      ['ファミリーマート', 120, true],
      ['ローソン', 155, false],
    ]);
    const single = buildItemDetail(
      'お茶',
      occ.filter((o) => o.storeLabel === 'ローソン'),
    );
    expect(single.stores).toHaveLength(1);
    expect(single.stores[0]!.cheapest).toBe(false);
  });

  it('折れ線の座標:高い単価ほど上(y が小さい)。値が同じなら水平、1点なら中央', () => {
    const pts = sparklinePoints(detail.points, 200, 60);
    expect(pts).toHaveLength(4);
    expect(pts[2]!.y).toBeLessThan(pts[1]!.y); // 160円 は 118円 より上
    expect(pts[0]!.x).toBeLessThan(pts[3]!.x);
    const flat = sparklinePoints(
      [
        { date: '2026-09-01', unitYen: 100, storeLabel: 'a' },
        { date: '2026-09-02', unitYen: 100, storeLabel: 'a' },
      ],
      200,
      60,
    );
    expect(flat[0]!.y).toBe(flat[1]!.y);
    expect(
      sparklinePoints([{ date: '2026-09-01', unitYen: 5, storeLabel: 'a' }], 200, 60)[0]!.x,
    ).toBe(100);
    expect(sparklinePoints([], 200, 60)).toEqual([]);
  });
});

describe('P5 仮想化(1万件でも滑らか)', () => {
  it('1万件でも、見える範囲だけ(数十行)を返し、計算は一瞬', () => {
    const index = new VirtualIndex(10_000, 72);
    expect(index.totalHeight()).toBe(720_000);
    const t0 = performance.now();
    const r = index.range(360_000, 800, 6);
    const elapsed = performance.now() - t0;
    expect(r.end - r.start).toBeLessThan(30);
    expect(r.start).toBeLessThanOrEqual(5000);
    expect(r.end).toBeGreaterThan(5000);
    expect(elapsed).toBeLessThan(10);
    // 何度スクロールしても速い
    const t1 = performance.now();
    for (let y = 0; y < 720_000; y += 5000) index.range(y, 800, 6);
    expect(performance.now() - t1).toBeLessThan(50);
  });

  it('測れた高さに差し替えると、位置がずれない(後ろの行の位置が動く)', () => {
    const index = new VirtualIndex(100, 72);
    expect(index.offsetOf(10)).toBe(720);
    expect(index.setHeight(3, 120)).toBe(true);
    expect(index.setHeight(3, 120)).toBe(false); // 同じ高さなら変わらない
    expect(index.offsetOf(10)).toBe(720 + 48);
    expect(index.totalHeight()).toBe(7200 + 48);
  });

  it('先頭・末尾・空・件数の変更', () => {
    const index = new VirtualIndex(0, 72);
    expect(index.range(0, 800)).toEqual({ start: 0, end: 0 });
    index.resize(10);
    expect(index.range(0, 100, 0)).toEqual({ start: 0, end: 2 });
    expect(index.range(99_999, 800, 3).end).toBe(10);
    index.setHeight(0, 200);
    index.resize(20); // 測れた高さは引き継ぐ
    expect(index.offsetOf(1)).toBe(200);
  });

  it('タブごとのスクロール位置を覚える', () => {
    const m = new ScrollMemory<'tx' | 'items'>();
    expect(m.get('tx')).toBeNull();
    m.save('tx', 1234.6);
    m.save('items', 40);
    expect(m.get('tx')).toBe(1235);
    expect(m.get('items')).toBe(40);
  });
});
