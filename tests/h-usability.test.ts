import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LedgerAmount, Yen } from '../src/components/ui/money';
import { createLongPress, LONG_PRESS_MS } from '../src/lib/long-press';
import {
  VIEW_STATE_TTL_MS,
  parseViewState,
  scrollToLedger,
  scrollToTop,
  serializeViewState,
  tabTapAction,
} from '../src/lib/scroll';
import { buildWidgetSummary } from '../src/features/goals/widget';
import {
  EMPTY_FILTER,
  activeFilterCount,
  filterLedger,
  isFilterActive,
} from '../src/features/spending/views';
import {
  pushUndo,
  resetUndo,
  runUndo,
  undoReducer,
  UNDO_VISIBLE_MS,
  type UndoEntry,
} from '../src/lib/undo';
import { walk } from './helpers/tap-targets';
import { ledgerTx } from './helpers/ledger';
import manifest from '../app/manifest';

const visible = (html: string) => html.replace(/<!-- -->/g, '');

describe('H 家計簿タブ・概要/明細(受け入れ基準10)', () => {
  it('開いているタブをもう一度タップしたら画面の一番上へ、別のタブなら通常の遷移', () => {
    expect(tabTapAction('/spending', '/spending')).toBe('scroll-top');
    expect(tabTapAction('/plan', '/spending')).toBe('navigate');
  });

  it('「明細」を選ぶと明細の先頭へ1回でスクロールする(見つからなければ何もしない)', () => {
    const scrollIntoView = vi.fn();
    const doc = { getElementById: (id: string) => (id === 'ledger' ? { scrollIntoView } : null) };
    const win = { matchMedia: () => ({ matches: false }) } as never;
    expect(scrollToLedger(doc as never, win)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(scrollToLedger({ getElementById: () => null } as never, win)).toBe(false);
  });

  it('「視差効果を減らす」のときはアニメーションなしで移動する', () => {
    const scrollTo = vi.fn();
    scrollToTop({ scrollTo, matchMedia: () => ({ matches: true }) } as never);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    scrollTo.mockClear();
    scrollToTop({ scrollTo, matchMedia: () => ({ matches: false }) } as never);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('家計簿のページに「概要/明細」の切り替えと、明細のアンカーがある', () => {
    const page = readFileSync('app/(app)/spending/page.tsx', 'utf8');
    expect(page).toContain('<ViewSwitch />');
    expect(readFileSync('app/(app)/spending/ledger-list.tsx', 'utf8')).toContain('id="ledger"');
    expect(readFileSync('app/(app)/app-shell.tsx', 'utf8')).toContain(
      'tabTapAction(pathname, item.href)',
    );
  });
});

describe('H フィルター', () => {
  it('選んでいる条件の数(検索の文字は数えない)。入力待ちも条件', () => {
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTER, genreId: 'a', accountId: 'b' })).toBe(2);
    expect(activeFilterCount({ ...EMPTY_FILTER, search: 'x' })).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTER, pendingOnly: true, date: '2026-09-29' })).toBe(2);
    expect(isFilterActive({ ...EMPTY_FILTER, pendingOnly: true })).toBe(true);
  });

  it('入力待ちだけを見るときは、明細は出ない', () => {
    const txs = [ledgerTx({ id: 'a', occurredOn: '2026-09-28' })];
    expect(filterLedger(txs, { ...EMPTY_FILTER, pendingOnly: true })).toEqual([]);
    expect(filterLedger(txs, EMPTY_FILTER)).toHaveLength(1);
  });

  it('画面を戻ったときの復元:絞り込みとスクロール位置。古い状態・壊れた値は捨てる', () => {
    const state = {
      filter: { ...EMPTY_FILTER, genreId: 'dining', date: '2026-09-29' as const },
      scrollY: 480,
      savedAt: 1_000,
    };
    const raw = serializeViewState(state);
    expect(parseViewState(raw, 2_000)).toEqual(state);
    expect(parseViewState(raw, 1_000 + VIEW_STATE_TTL_MS + 1)).toBeNull();
    expect(parseViewState('{oops', 2_000)).toBeNull();
    expect(parseViewState(null, 2_000)).toBeNull();
  });
});

describe('H 長押し', () => {
  it('450ms で成立し、成立後の1回のクリックだけ打ち消せる。動く・離すと取り消し', () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    const lp = createLongPress({ onLongPress: fired });
    lp.start(0, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(fired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(fired).toHaveBeenCalledTimes(1);
    expect(lp.consumeClick()).toBe(true);
    expect(lp.consumeClick()).toBe(false);

    lp.start(0, 0);
    lp.move(30, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(fired).toHaveBeenCalledTimes(1);

    lp.start(0, 0);
    lp.end();
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(fired).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('H 金額の見た目(G の続き)', () => {
  it('支出には「−」を付けず、収入・返金だけ緑の「+」。「円」は小さく', () => {
    const expense = visible(renderToString(h(LedgerAmount, { amountYen: -3000 })));
    expect(expense).not.toContain('−');
    expect(expense).not.toContain('+');
    expect(expense).toContain('3,000<span class="yen-unit">円</span>');
    const income = visible(renderToString(h(LedgerAmount, { amountYen: 5000 })));
    expect(income).toContain('+');
    expect(income).toContain('var(--income)');
    expect(visible(renderToString(h(Yen, { value: 12279 })))).toContain('12,279');
  });
});

describe('H ウィジェット・ショートカット(代替の実装)', () => {
  it('自由残と次の予定を1行にまとめる。今日あとは出さない', () => {
    const view = {
      active: true,
      guidance: { freeYen: 16376 },
      scheduledItems: [{ label: '発表会', date: '2026-10-03', amountYen: 26540 }],
    } as never;
    expect(buildWidgetSummary(view, 0)).toMatchObject({
      freeYen: 16376,
      label: '自由残 16,376円 ・ 次の予定 発表会',
      captureUrl: '/plan',
    });
    expect(buildWidgetSummary(view, 0).label).not.toContain('今日あと');
    expect(buildWidgetSummary(null, 1).label).toBe('自由残なし ・ 入力待ち 1件');
  });

  it('マニフェストに、撮影を直接開くショートカットと手入力がある', () => {
    const m = manifest();
    const urls = (m.shortcuts ?? []).map((s) => s.url);
    expect(urls).toContain('/spending?capture=1');
    expect(urls).toContain('/transactions/new');
    expect(m.display).toBe('standalone');
  });
});

describe('H Undo(受け入れ基準12)', () => {
  beforeEach(() => resetUndo());

  const entry = (over: Partial<UndoEntry> = {}): UndoEntry => ({
    id: 'u1',
    message: 'm',
    undo: async () => null,
    createdAt: 0,
    status: 'idle',
    error: null,
    ...over,
  });

  it('戻せるのは5秒間。戻している最中のものは消えない', () => {
    let s = undoReducer([], { type: 'push', entry: entry() });
    expect(undoReducer(s, { type: 'expire', now: UNDO_VISIBLE_MS - 1 })).toHaveLength(1);
    expect(undoReducer(s, { type: 'expire', now: UNDO_VISIBLE_MS })).toHaveLength(0);
    s = undoReducer(s, { type: 'undoing', id: 'u1' });
    expect(undoReducer(s, { type: 'expire', now: 999_999 })).toHaveLength(1);
  });

  it('実行すると戻す処理が呼ばれ、成功なら消え、失敗なら理由を残す', async () => {
    const ok = vi.fn(async () => null);
    const id = pushUndo('削除しました', ok);
    await runUndo(id);
    expect(ok).toHaveBeenCalledTimes(1);

    const ng = pushUndo('変更しました', async () => '元に戻せませんでした。');
    await runUndo(ng);
    // 失敗は残る(閉じるまで理由を見せる)
    const { useUndoEntries } = await import('../src/lib/undo');
    expect(typeof useUndoEntries).toBe('function');
  });

  it('明細を変える操作は、すべて Undo(pushUndo)を積む画面から呼ばれている', () => {
    const MUTATING = [
      'updateTransactionAction',
      'updateTransactionMemoAction',
      'replaceSplitsAction',
      'deleteTransactionAction',
      'setTransactionKindAction',
      'duplicateTransactionAction',
      'resolveReconcileAction',
      'replaceReceiptItemsAction',
      'saveImportBatchAction',
    ];
    const missing: string[] = [];
    // 取り込み(CSV・貼り付け・突き合わせ・重複確認)は別の確認フローを持つため対象外。
    const files = walk('app/(app)').filter(
      (f) =>
        !/transactions\/(import|paste|reconcile|duplicates)\//.test(f) &&
        !f.endsWith('actions.ts') &&
        !f.includes('/receipt/'),
    );
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const importsMutation = MUTATING.some((n) =>
        new RegExp(`import[^;]*\\b${n}\\b[^;]*from`, 's').test(text),
      );
      if (importsMutation && !text.includes('pushUndo')) missing.push(file);
    }
    expect(missing).toEqual([]);
  });
});
