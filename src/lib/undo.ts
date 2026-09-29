/**
 * 「元に戻す」のトースト(変更・削除・移動のすべてで共通)。
 *
 * 変更や削除のたびに pushUndo で「戻す処理」を積み、画面下のトースト(UndoToastHost)に
 * 「元に戻す」を5秒間出す。新しい変更が来たら、前のトーストは置き換える(戻せるのは直近のもの、
 * ただし前の分も期限内なら履歴として残す)。状態遷移は純粋な reducer にしてテストできる。
 */

import { useSyncExternalStore } from 'react';

export const UNDO_VISIBLE_MS = 5000;

export type UndoEntry = {
  id: string;
  message: string;
  /** 戻す処理。失敗したらエラー文言を返す。 */
  undo: () => Promise<string | null>;
  createdAt: number;
  status: 'idle' | 'undoing' | 'failed';
  error: string | null;
};

export type UndoAction =
  | { type: 'push'; entry: UndoEntry }
  | { type: 'undoing'; id: string }
  | { type: 'failed'; id: string; error: string }
  | { type: 'dismiss'; id: string }
  | { type: 'expire'; now: number };

export function undoReducer(state: readonly UndoEntry[], action: UndoAction): UndoEntry[] {
  switch (action.type) {
    case 'push':
      // 表示するのは直近の1件(複数積んでも、戻せる期間は各自5秒)
      return [...state.filter((e) => e.status === 'undoing'), action.entry];
    case 'undoing':
      return state.map((e) => (e.id === action.id ? { ...e, status: 'undoing', error: null } : e));
    case 'failed':
      return state.map((e) =>
        e.id === action.id ? { ...e, status: 'failed', error: action.error } : e,
      );
    case 'dismiss':
      return state.filter((e) => e.id !== action.id);
    case 'expire':
      return state.filter((e) => e.status !== 'idle' || action.now - e.createdAt < UNDO_VISIBLE_MS);
  }
}

let state: UndoEntry[] = [];
const listeners = new Set<() => void>();
let seq = 0;

function dispatch(action: UndoAction): void {
  state = undoReducer(state, action);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: UndoEntry[] = [];

export function useUndoEntries(): readonly UndoEntry[] {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}

/** 「元に戻す」を積む。undo は成功なら null、失敗なら理由を返す。 */
export function pushUndo(message: string, undo: () => Promise<string | null>): string {
  seq += 1;
  const id = `undo-${Date.now()}-${seq}`;
  dispatch({
    type: 'push',
    entry: { id, message, undo, createdAt: Date.now(), status: 'idle', error: null },
  });
  return id;
}

export async function runUndo(id: string): Promise<void> {
  const entry = state.find((e) => e.id === id);
  if (!entry || entry.status === 'undoing') return;
  dispatch({ type: 'undoing', id });
  let error: string | null;
  try {
    error = await entry.undo();
  } catch {
    error = '元に戻せませんでした。';
  }
  if (error === null) dispatch({ type: 'dismiss', id });
  else dispatch({ type: 'failed', id, error });
}

export function dismissUndo(id: string): void {
  dispatch({ type: 'dismiss', id });
}

export function expireUndo(now: number): void {
  if (state.some((e) => e.status === 'idle' && now - e.createdAt >= UNDO_VISIBLE_MS)) {
    dispatch({ type: 'expire', now });
  }
}

/** テスト用:キューを空にする。 */
export function resetUndo(): void {
  state = [];
  for (const l of listeners) l();
}
