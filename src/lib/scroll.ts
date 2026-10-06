/**
 * スクロールまわりの小さな部品(家計簿の「概要/明細」の切り替え、タブの再タップ、
 * 画面を戻ったときの位置の復元)。DOM に触る関数は、テストで差し替えられるよう引数で受ける。
 */

import type { LedgerFilter } from '@/features/spending/views';

export const LEDGER_ANCHOR = 'ledger';

function prefersReducedMotion(win: Pick<Window, 'matchMedia'>): boolean {
  return win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** 画面の一番上へ(「視差効果を減らす」のときはアニメーションなし)。 */
export function scrollToTop(win: Pick<Window, 'scrollTo' | 'matchMedia'> = window): void {
  win.scrollTo({ top: 0, behavior: prefersReducedMotion(win) ? 'auto' : 'smooth' });
}

/** 明細の先頭へ。見つからなければ false。 */
export function scrollToLedger(
  doc: Pick<Document, 'getElementById'> = document,
  win: Pick<Window, 'matchMedia'> = window,
): boolean {
  const el = doc.getElementById(LEDGER_ANCHOR);
  if (el === null) return false;
  el.scrollIntoView({ behavior: prefersReducedMotion(win) ? 'auto' : 'smooth', block: 'start' });
  return true;
}

/** 今開いているタブをもう一度タップしたら、画面の一番上へ戻る(別のタブなら通常の遷移)。 */
export function tabTapAction(pathname: string, href: string): 'scroll-top' | 'navigate' {
  return pathname === href ? 'scroll-top' : 'navigate';
}

// ---- 家計簿の見ていた状態(絞り込み・スクロール位置)を、戻ったときに復元する ----

export const VIEW_STATE_KEY = 'spending:view-state';

export type ViewState = { filter: LedgerFilter; scrollY: number; savedAt: number };

export function serializeViewState(state: ViewState): string {
  return JSON.stringify(state);
}

/** 保存してから何分以内なら復元するか(古い状態を引きずらない)。 */
export const VIEW_STATE_TTL_MS = 30 * 60 * 1000;

export function parseViewState(raw: string | null, now: number): ViewState | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as Partial<ViewState>;
    if (
      typeof v.savedAt !== 'number' ||
      now - v.savedAt > VIEW_STATE_TTL_MS ||
      typeof v.scrollY !== 'number' ||
      typeof v.filter !== 'object' ||
      v.filter === null
    ) {
      return null;
    }
    const f = v.filter as Partial<LedgerFilter>;
    return {
      scrollY: Math.max(0, v.scrollY),
      savedAt: v.savedAt,
      filter: {
        genreId: typeof f.genreId === 'string' ? f.genreId : null,
        date: typeof f.date === 'string' ? f.date : null,
        accountId: typeof f.accountId === 'string' ? f.accountId : null,
        range:
          f.range && typeof f.range.from === 'string' && typeof f.range.to === 'string'
            ? f.range
            : null,
        search: typeof f.search === 'string' ? f.search : '',
        pendingOnly: f.pendingOnly === true,
      },
    };
  } catch {
    return null;
  }
}
