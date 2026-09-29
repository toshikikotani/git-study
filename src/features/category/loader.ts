/**
 * カテゴリ詳細の読み込み(サーバー)。
 *
 * 明細の読み方は家計簿と同じ(entries.ts の loadLedgerTransactions)。選んだ月と、その前の
 * 数か月(グラフの「月」表示・前期間の比較に使う)を1回で読み、このカテゴリに関わる明細だけを
 * 画面へ渡す(分割したレシートは、このカテゴリの品目を含むものが残る)。
 */

import { monthRange, type LedgerRange } from '@/domain/ledger';
import { listAccounts } from '@/features/accounts/store';
import { loadGoalView } from '@/features/goals/loader';
import type { GoalBreakdownRow } from '@/features/goals/view';
import { listReceiptItemsForTransactionIds } from '@/features/receipts/items-store';
import { loadLedgerTransactions } from '@/features/spending/entries';
import { attachThumbnails } from '@/features/spending/thumbnails';
import { toLedgerEntries } from '@/features/spending/views';
import { addMonths, nthDayOfMonth, todayJst } from '@/lib/date';
import { genreIdOfKey, type CategoryTx } from './model';

/** グラフの「月」表示と前期間の比較のために、選んだ月から何か月前まで読むか。 */
export const HISTORY_MONTHS = 6;

export type CategoryDetailData = {
  genreKey: string;
  genreName: string;
  /** ジャンルの予算(genres.budget_yen)。目標が無い月の目安に使う。 */
  genreBudgetYen: number | null;
  monthKey: string;
  monthStart: string;
  today: string;
  isCurrentMonth: boolean;
  /** 選んだ月の範囲(月末まで。今日より先は予定)。 */
  range: LedgerRange;
  /** 読み込んだ範囲(履歴を含む)。 */
  windowFrom: string;
  transactions: CategoryTx[];
  genres: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
  /**
   * 「店 → ジャンル」の過去の選び方(未分類の予測に使う)。履歴を含む全部の明細から、
   * 店とジャンルの組ごとに回数をまとめたもの。
   */
  genreHistory: { storeName: string; genreId: string; count: number }[];
  goal: null | {
    range: { from: string; to: string };
    dailyAllowanceYen: number | null;
    active: boolean;
    row: GoalBreakdownRow | null;
    /** 進行中の目標の配分(カテゴリ設定から「配分・総額を調整する」を開くため)。 */
    plan: null | {
      id: string;
      periodStart: string;
      periodEnd: string;
      rows: {
        genreId: string;
        genreName: string;
        baselineYen: number | null;
        note: string | null;
        yen: number;
      }[];
    };
  };
};

export function parseMonthKey(value: string | undefined, today: string): string {
  if (value && /^\d{4}-(0[1-9]|1[0-2])/.test(value)) return value.slice(0, 7);
  return today.slice(0, 7);
}

export async function loadCategoryDetail(input: {
  genreKey: string;
  month?: string | undefined;
  now?: Date;
}): Promise<CategoryDetailData | null> {
  const now = input.now ?? new Date();
  const today = todayJst(now);
  const monthKey = parseMonthKey(input.month, today);
  const monthStart = `${monthKey}-01`;
  const range = monthRange(monthKey);
  const windowFrom = nthDayOfMonth(addMonths(monthStart, -HISTORY_MONTHS), 1);

  const [loaded, accounts, goalLoaded] = await Promise.all([
    loadLedgerTransactions({ from: windowFrom, to: range.to }, today),
    listAccounts(),
    loadGoalView(now).catch(() => null),
  ]);

  const genreId = genreIdOfKey(input.genreKey);
  const genre = genreId === null ? null : loaded.genres.find((g) => g.id === genreId);
  if (genreId !== null && !genre) return null;

  const listed = loaded.transactions.filter((t) => !t.isTransfer && t.reviewStatus !== 'ignored');
  // このカテゴリに関わる明細だけ(分割の子にこのカテゴリがあるものを含む)。
  const touching = listed.filter((t) => toLedgerEntries([t]).some((e) => e.categoryId === genreId));
  const withThumbs = await attachThumbnails(touching, loaded.batchIdByTransactionId);
  const items = await listReceiptItemsForTransactionIds(withThumbs.map((t) => t.id));

  const view = goalLoaded?.view ?? null;
  const history = new Map<string, { storeName: string; genreId: string; count: number }>();
  for (const t of listed) {
    if (t.genreId === null || t.amountYen >= 0 || t.needsInput) continue;
    const key = `${t.label}\u0000${t.genreId}`;
    const e = history.get(key) ?? { storeName: t.label, genreId: t.genreId, count: 0 };
    e.count += 1;
    history.set(key, e);
  }
  return {
    genreKey: input.genreKey,
    genreName: genre?.name ?? '未分類',
    genreBudgetYen: genre?.budget_yen ?? null,
    monthKey,
    monthStart,
    today,
    isCurrentMonth: monthKey === today.slice(0, 7),
    range,
    windowFrom,
    transactions: withThumbs.map((t) => ({ ...t, items: items.get(t.id) ?? [] })),
    genres: loaded.genres.map((g) => ({ id: g.id, name: g.name })),
    accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
    genreHistory: [...history.values()].sort((a, b) => b.count - a.count).slice(0, 1500),
    goal:
      view === null
        ? null
        : {
            range: view.range,
            dailyAllowanceYen: view.dailyAllowanceYen,
            active: view.active,
            row: view.breakdown.find((r) => r.genreId === genreId) ?? null,
            plan:
              view.active && goalLoaded
                ? {
                    id: goalLoaded.plan.id,
                    periodStart: goalLoaded.plan.periodStart,
                    periodEnd: goalLoaded.plan.periodEnd,
                    rows: goalLoaded.plan.items.map((item) => ({
                      genreId: item.genreId,
                      genreName: item.genreName,
                      baselineYen: null,
                      note: item.reason,
                      yen: item.targetYen,
                    })),
                  }
                : null,
          },
  };
}
