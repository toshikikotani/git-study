import { describe, expect, it, vi } from 'vitest';

import { monthRange } from '../../../src/domain/ledger';
import {
  moveItem,
  moveTransactions,
  patchTransaction,
  restoreTransactions,
} from '../../../src/features/category/edits';
import { pickQuickDestination, bumpCount } from '../../../src/features/category/destinations';
import {
  actualSpentYen,
  buildCategoryLines,
  categorySpentFromLedger,
  type CategoryTx,
} from '../../../src/features/category/model';
import { buildSeries } from '../../../src/features/category/series';
import { optimistic } from '../../../src/lib/optimistic';
import { SHEET_CLOSE_PX, keyboardInset, nextSheetState } from '../../../src/lib/sheet';
import { ledgerSplit, ledgerTx } from '../../helpers/ledger';

const TODAY = '2026-09-29';
const SEP = monthRange('2026-09');
const genres = [
  { id: 'dining', name: '外食' },
  { id: 'cafe', name: 'カフェ' },
  { id: 'hobby', name: '娯楽' },
];
const tx = (o: Parameters<typeof ledgerTx>[0], items: CategoryTx['items'] = []): CategoryTx => ({
  ...ledgerTx(o),
  items,
});
const base: CategoryTx[] = [
  tx({ id: 'a', occurredOn: '2026-09-05', genreId: 'dining', amountYen: -1200 }),
  tx({ id: 'b', occurredOn: '2026-09-12', genreId: 'dining', amountYen: -800 }),
  tx(
    {
      id: 'd',
      occurredOn: '2026-09-20',
      genreId: 'dining',
      amountYen: -3000,
      splits: [
        ledgerSplit({
          genreId: 'dining',
          genreName: '外食',
          amountYen: -1000,
          note: 'サンドイッチ',
        }),
        ledgerSplit({ genreId: 'cafe', genreName: 'カフェ', amountYen: -2000, note: 'コーヒー豆' }),
      ],
    },
    [
      {
        id: 's',
        name: 'サンドイッチ',
        amountYen: -1000,
        genreId: 'dining',
        genreName: '外食',
        productType: null,
      },
      {
        id: 'c',
        name: 'コーヒー豆',
        amountYen: -2000,
        genreId: 'cafe',
        genreName: 'カフェ',
        productType: null,
      },
    ],
  ),
];

const total = (txs: CategoryTx[], g: string) => categorySpentFromLedger(txs, g, SEP, TODAY);

describe('P6 楽観的更新(受け入れ基準8):移すと、サマリー・グラフがすぐ変わり、元に戻せる', () => {
  it('1件を別のカテゴリへ移すと、このカテゴリの合計が減り、移した先の合計が増える', () => {
    expect(total(base, 'dining')).toBe(1200 + 800 + 1000);
    const moved = moveTransactions(base, new Set(['a']), 'dining', 'cafe', genres);
    expect(total(moved, 'dining')).toBe(800 + 1000);
    expect(total(moved, 'cafe')).toBe(1200 + 2000);
    // 画面が持つ行・グラフも同じ値になる
    const lines = buildCategoryLines(moved, 'dining', SEP, TODAY);
    expect(actualSpentYen(lines)).toBe(1800);
    const day = buildSeries({
      lines,
      unit: 'day',
      monthStart: '2026-09-01',
      monthEnd: SEP.to,
      today: TODAY,
      dailyAllowanceYen: null,
    });
    expect(day.buckets[4]!.actualYen).toBe(0); // 9/5 は移したので0
    expect(day.totalYen).toBe(1800);
  });

  it('Undo:元の明細を戻すと、合計もグラフも元に戻る', () => {
    const moved = moveTransactions(base, new Set(['a']), 'dining', 'cafe', genres);
    const originals = base.filter((t) => t.id === 'a');
    const back = restoreTransactions(moved, originals);
    expect(total(back, 'dining')).toBe(total(base, 'dining'));
    expect(back.find((t) => t.id === 'a')!.genreId).toBe('dining');
    // 一覧から消えていた明細も戻る
    expect(restoreTransactions([], originals)).toHaveLength(1);
  });

  it('分割したレシートは、このカテゴリの部分だけが移る(全体は残る)', () => {
    const moved = moveTransactions(base, new Set(['d']), 'dining', 'hobby', genres);
    const d = moved.find((t) => t.id === 'd')!;
    expect(d.splits.map((s) => [s.genreId, s.amountYen])).toEqual([
      ['hobby', -1000],
      ['cafe', -2000],
    ]);
    expect(d.amountYen).toBe(-3000);
    expect(total(moved, 'dining')).toBe(1200 + 800);
    expect(total(moved, 'hobby')).toBe(1000);
  });

  it('品目1つだけを移すと、レシートの分割が更新され、各カテゴリの合計に反映される(受け入れ基準9)', () => {
    const moved = moveItem(base, 'd', 's', 'hobby', genres);
    const d = moved.find((t) => t.id === 'd')!;
    expect(d.splits.reduce((a, s) => a + s.amountYen, 0)).toBe(-3000);
    expect(d.items.find((i) => i.id === 's')!.genreId).toBe('hobby');
    expect(total(moved, 'dining')).toBe(1200 + 800);
    expect(total(moved, 'hobby')).toBe(1000);
    expect(total(moved, 'cafe')).toBe(2000);
  });

  it('金額・日付・店名・メモの編集がすぐ反映される', () => {
    const edited = patchTransaction(base, 'a', {
      amountYen: -1500,
      occurredOn: '2026-09-06',
      label: 'ココカラ',
      memo: 'メモ',
    });
    const a = edited.find((t) => t.id === 'a')!;
    expect([a.amountYen, a.occurredOn, a.label, a.memo]).toEqual([
      -1500,
      '2026-09-06',
      'ココカラ',
      'メモ',
    ]);
    expect(total(edited, 'dining')).toBe(1500 + 800 + 1000);
  });
});

describe('P6 保存に失敗したら元に戻して理由を出す', () => {
  it('成功:apply は1回、rollback は呼ばれず、結果を返す', async () => {
    const apply = vi.fn();
    const rollback = vi.fn();
    const r = await optimistic({
      apply,
      rollback,
      request: async () => ({ error: null, value: 1 }),
    });
    expect(r).toEqual({ ok: true, result: { error: null, value: 1 } });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
  });

  it('サーバーがエラーを返したら、元に戻して理由を返す', async () => {
    const apply = vi.fn();
    const rollback = vi.fn();
    const r = await optimistic({
      apply,
      rollback,
      request: async () => ({ error: '分割の合計が金額と合わないため、移せません。' }),
    });
    expect(r).toEqual({ ok: false, error: '分割の合計が金額と合わないため、移せません。' });
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('通信が失敗(例外)しても、元に戻して、責めない言葉で伝える', async () => {
    const rollback = vi.fn();
    const r = await optimistic({
      apply: () => {},
      rollback,
      request: async () => {
        throw new Error('network');
      },
    });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('通信状況を確かめて');
  });
});

describe('P6 右スワイプの移動先(最もよく使う移動先)', () => {
  it('よく移した順。いまのカテゴリは選ばない。履歴が無ければ予測、それも無ければ先頭', () => {
    expect(
      pickQuickDestination({ counts: { cafe: 1, hobby: 5 }, genres, currentGenreId: 'dining' })?.id,
    ).toBe('hobby');
    expect(
      pickQuickDestination({
        counts: { dining: 9 },
        genres,
        currentGenreId: 'dining',
        predictedGenreId: 'cafe',
      })?.id,
    ).toBe('cafe');
    expect(pickQuickDestination({ counts: {}, genres, currentGenreId: 'dining' })?.id).toBe('cafe');
    expect(
      pickQuickDestination({ counts: {}, genres: [genres[0]!], currentGenreId: 'dining' }),
    ).toBeNull();
    expect(bumpCount({ a: 1 }, 'a')).toEqual({ a: 2 });
  });
});

describe('P6 編集シート(半分 ⇄ 全画面、キーボード)', () => {
  it('上へ払うと全画面、全画面から下へ払うと半分、半分から大きく下へ払うと閉じる', () => {
    expect(nextSheetState('half', -80)).toBe('full');
    expect(nextSheetState('half', 20)).toBe('half');
    expect(nextSheetState('half', SHEET_CLOSE_PX)).toBe('closed');
    expect(nextSheetState('full', 80)).toBe('half');
    expect(nextSheetState('full', -80)).toBe('full');
    expect(nextSheetState('half', -10, -1)).toBe('full'); // 速く払った
    expect(nextSheetState('closed', -200)).toBe('closed');
  });

  it('キーボードが隠している高さぶん、シートを持ち上げる', () => {
    expect(keyboardInset({ innerHeight: 800, visualHeight: 500, visualOffsetTop: 0 })).toBe(300);
    expect(keyboardInset({ innerHeight: 800, visualHeight: 800, visualOffsetTop: 0 })).toBe(0);
    expect(keyboardInset({ innerHeight: 800, visualHeight: 900, visualOffsetTop: 0 })).toBe(0);
  });
});
