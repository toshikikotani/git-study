'use client';

import { useCallback, useState } from 'react';

import {
  moveItem,
  moveTransactions,
  patchTransaction,
  restoreTransactions,
  type GenreRef,
  type TxPatch,
} from '@/features/category/edits';
import { genreIdOfKey, type CategoryLine, type CategoryTx } from '@/features/category/model';
import { recordMove } from '@/features/category/destinations';
import { hapticFor } from '@/lib/haptics';
import { MOTION } from '@/lib/motion';
import { optimistic } from '@/lib/optimistic';
import { pushUndo } from '@/lib/undo';
import {
  moveItemAction,
  moveTransactionsAction,
  restoreFieldsAction,
  restoreMovesAction,
  updateFieldsAction,
} from '../actions';

/**
 * カテゴリ詳細の編集の状態と操作(楽観的更新)。
 *
 * どの操作も、画面を先に書き換え(合計・グラフ・気づきは、この状態から家計簿と同じ集計関数で
 * 計算し直される)、保存に失敗したら元へ戻して理由を出す。成功したら5秒間の「元に戻す」を出す。
 * 別のカテゴリへ移した行は、250ms の間だけ「消えていく行」(ghost)として一覧に残し、
 * 高さと透明度を同時に変えて消す。
 */
export function useCategoryEdits(input: {
  initial: readonly CategoryTx[];
  genreKey: string;
  genres: readonly GenreRef[];
}) {
  const { genreKey, genres } = input;
  const fromGenreId = genreIdOfKey(genreKey);
  const [transactions, setTransactions] = useState<CategoryTx[]>([...input.initial]);
  const [ghosts, setGhosts] = useState<CategoryLine[]>([]);
  const [banner, setBanner] = useState<string | null>(null);

  const nameOf = (id: string | null) =>
    id === null ? '未分類' : (genres.find((g) => g.id === id)?.name ?? 'ほかのカテゴリ');

  const dropGhosts = useCallback((ids: ReadonlySet<string>) => {
    window.setTimeout(
      () => setGhosts((prev) => prev.filter((g) => !ids.has(g.txId))),
      MOTION.rowMs,
    );
  }, []);

  /** 明細(の、このカテゴリに属する部分)を別のカテゴリへ移す。一括でも使う。 */
  const moveLines = async (lines: readonly CategoryLine[], toGenreId: string | null) => {
    if (lines.length === 0) return false;
    const ids = new Set(lines.map((l) => l.txId));
    const originals = transactions.filter((t) => ids.has(t.id));
    const outcome = await optimistic({
      apply: () => {
        setGhosts((prev) => [...prev, ...lines]);
        setTransactions((t) => moveTransactions(t, ids, fromGenreId, toGenreId, genres));
        dropGhosts(ids);
      },
      rollback: () => {
        setGhosts((prev) => prev.filter((g) => !ids.has(g.txId)));
        setTransactions((t) => restoreTransactions(t, originals));
      },
      request: () => moveTransactionsAction({ ids: [...ids], fromGenreId, toGenreId }),
    });
    if (!outcome.ok) {
      setBanner(`移せませんでした。${outcome.error}`);
      return false;
    }
    hapticFor('categoryMove');
    recordMove(toGenreId);
    const previous = outcome.result.previous ?? [];
    pushUndo(
      `${lines.length === 1 ? '1件' : `${lines.length}件`}を${nameOf(toGenreId)}へ移しました`,
      async () => {
        const r = await restoreMovesAction(previous);
        if (r.error) return r.error;
        setTransactions((t) => restoreTransactions(t, originals));
        return null;
      },
    );
    return true;
  };

  /** 分割したレシートの品目1つだけを、別のカテゴリへ移す。 */
  const moveOneItem = async (line: CategoryLine, itemId: string, toGenreId: string | null) => {
    const original = transactions.find((t) => t.id === line.txId);
    if (!original) return false;
    const outcome = await optimistic({
      apply: () => setTransactions((t) => moveItem(t, line.txId, itemId, toGenreId, genres)),
      rollback: () => setTransactions((t) => restoreTransactions(t, [original])),
      request: () => moveItemAction({ transactionId: line.txId, itemId, toGenreId }),
    });
    if (!outcome.ok) {
      setBanner(`品目を移せませんでした。${outcome.error}`);
      return false;
    }
    hapticFor('categoryMove');
    recordMove(toGenreId);
    const previous = outcome.result.previous ?? [];
    pushUndo(`品目を${nameOf(toGenreId)}へ移しました`, async () => {
      const r = await restoreMovesAction(previous);
      if (r.error) return r.error;
      setTransactions((t) => restoreTransactions(t, [original]));
      return null;
    });
    return true;
  };

  /** 金額・日付・店名・メモを直す。 */
  const saveEdit = async (line: CategoryLine, patch: TxPatch) => {
    const original = transactions.find((t) => t.id === line.txId);
    if (!original) return false;
    const outcome = await optimistic({
      apply: () => setTransactions((t) => patchTransaction(t, line.txId, patch)),
      rollback: () => setTransactions((t) => restoreTransactions(t, [original])),
      request: () =>
        updateFieldsAction(line.txId, {
          ...(patch.amountYen !== undefined ? { amountYen: patch.amountYen } : {}),
          ...(patch.occurredOn !== undefined ? { occurredOn: patch.occurredOn } : {}),
          ...(patch.label !== undefined ? { merchantName: patch.label } : {}),
          ...(patch.memo !== undefined ? { note: patch.memo } : {}),
        }),
    });
    if (!outcome.ok) {
      setBanner(`保存できませんでした。${outcome.error}`);
      return false;
    }
    hapticFor('save');
    const previous = outcome.result.previous;
    if (previous) {
      pushUndo('変更を保存しました', async () => {
        const r = await restoreFieldsAction(previous);
        if (r.error) return r.error;
        setTransactions((t) => restoreTransactions(t, [original]));
        return null;
      });
    }
    return true;
  };

  return {
    transactions,
    setTransactions,
    ghosts,
    banner,
    dismissBanner: () => setBanner(null),
    moveLines,
    moveOneItem,
    saveEdit,
  };
}
