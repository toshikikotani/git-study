/**
 * カテゴリ詳細の楽観的更新(画面の明細の状態を、保存を待たずに書き換える純粋関数)。
 * カテゴリの移動は domain/category-move.ts の計画を使う(サーバーと同じ計画なので、
 * 保存の結果と画面の見た目がずれない)。
 */

import {
  applyPlanToInput,
  planCategoryMove,
  planItemMove,
  planWholeMove,
  type MoveInput,
  type MovePlan,
} from '@/domain/category-move';
import { comparableKey } from '@/domain/store-name';
import type { RuleScope } from '@/domain/rule-match';
import type { CategoryTx } from './model';

export type GenreRef = { id: string; name: string };

const nameOf = (genres: readonly GenreRef[], id: string | null): string | null =>
  id === null ? null : (genres.find((g) => g.id === id)?.name ?? null);

export function toMoveInput(tx: CategoryTx): MoveInput {
  return {
    amountYen: tx.amountYen,
    genreId: tx.genreId,
    splits: tx.splits.map((s) => ({ genreId: s.genreId, amountYen: s.amountYen, note: s.note })),
    items: tx.items.map((i) => ({
      id: i.id,
      name: i.name,
      amountYen: i.amountYen,
      genreId: i.genreId,
    })),
  };
}

/** 移動の計画を、明細に適用する(ジャンル・分割・品目のジャンル)。 */
export function applyMovePlan(
  tx: CategoryTx,
  plan: MovePlan,
  genres: readonly GenreRef[],
): CategoryTx {
  return {
    ...tx,
    genreId: plan.genreId,
    genreName: nameOf(genres, plan.genreId),
    splits: plan.splits.map((s, i) => ({
      id: `plan-${tx.id}-${i}`,
      note: s.note,
      genreId: s.genreId,
      genreName: nameOf(genres, s.genreId),
      amountYen: s.amountYen,
    })),
    items: tx.items.map((i) =>
      plan.itemGenres.has(i.id)
        ? {
            ...i,
            genreId: plan.itemGenres.get(i.id)!,
            genreName: nameOf(genres, plan.itemGenres.get(i.id)!),
          }
        : i,
    ),
  };
}

/** 明細(の、fromGenreId に属する部分)を toGenreId へ移す。 */
export function moveTransactions(
  txs: readonly CategoryTx[],
  ids: ReadonlySet<string>,
  fromGenreId: string | null,
  toGenreId: string | null,
  genres: readonly GenreRef[],
): CategoryTx[] {
  return txs.map((t) =>
    ids.has(t.id)
      ? applyMovePlan(t, planCategoryMove(toMoveInput(t), fromGenreId, toGenreId), genres)
      : t,
  );
}

/** 品目1つだけを別のカテゴリへ移し、分割の内訳を作り直す。 */
export function moveItem(
  txs: readonly CategoryTx[],
  txId: string,
  itemId: string,
  toGenreId: string | null,
  genres: readonly GenreRef[],
): CategoryTx[] {
  return txs.map((t) =>
    t.id === txId ? applyMovePlan(t, planItemMove(toMoveInput(t), itemId, toGenreId), genres) : t,
  );
}

export type TxPatch = {
  amountYen?: number;
  occurredOn?: string;
  label?: string;
  memo?: string | null;
};

export function patchTransaction(
  txs: readonly CategoryTx[],
  id: string,
  patch: TxPatch,
): CategoryTx[] {
  return txs.map((t) =>
    t.id === id
      ? {
          ...t,
          ...(patch.amountYen !== undefined ? { amountYen: patch.amountYen } : {}),
          ...(patch.occurredOn !== undefined ? { occurredOn: patch.occurredOn } : {}),
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.memo !== undefined ? { memo: patch.memo } : {}),
        }
      : t,
  );
}

/** 消した明細を、元の位置へ戻す(Undo・失敗の巻き戻し)。 */
export function restoreTransactions(
  current: readonly CategoryTx[],
  originals: readonly CategoryTx[],
): CategoryTx[] {
  const byId = new Map(originals.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const next = current.map((t) => {
    seen.add(t.id);
    return byId.get(t.id) ?? t;
  });
  for (const o of originals) if (!seen.has(o.id)) next.push(o);
  return next;
}

/** 分類ルールを、すでにある明細に当てた結果(画面の状態にも同じ変更を反映する)。 */
export function applyRuleLocally(
  txs: readonly CategoryTx[],
  scope: RuleScope,
  ids: ReadonlySet<string>,
  toGenreId: string,
  genres: readonly GenreRef[],
): CategoryTx[] {
  return txs.map((t) => {
    if (!ids.has(t.id)) return t;
    const input = toMoveInput(t);
    if (scope.kind === 'store') return applyMovePlan(t, planWholeMove(input, toGenreId), genres);
    const key = comparableKey(scope.itemName);
    let current = input;
    const itemGenres = new Map<string, string | null>();
    let last: MovePlan | null = null;
    for (const item of input.items) {
      if (comparableKey(item.name) !== key) continue;
      last = planItemMove(current, item.id, toGenreId);
      current = applyPlanToInput(current, last);
      for (const [k, v] of last.itemGenres) itemGenres.set(k, v);
    }
    if (last === null) return t;
    return applyMovePlan(t, { genreId: last.genreId, splits: last.splits, itemGenres }, genres);
  });
}

/** 明細を消す(一括削除の楽観的更新)。 */
export function removeTransactions(
  txs: readonly CategoryTx[],
  ids: ReadonlySet<string>,
): CategoryTx[] {
  return txs.filter((t) => !ids.has(t.id));
}
