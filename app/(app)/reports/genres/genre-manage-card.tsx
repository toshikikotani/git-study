'use client';

/**
 * ジャンルの一覧管理(本人発案「カテゴリはdbに保存してenumじゃなくて、
 * 自由に変更できる仕組みに。追加削除容易にしたい」、ADR-056/ADR-057)。
 *
 * ADR-057で旧 /rules(カテゴリ管理)を廃止し、ここへ統合した。本人が
 * 設定するのは「ジャンルの増減」と「それぞれの値段設定(予算)」の2つ
 * (本人発案:「ユーザーが設定するのはカテゴリのそれぞれの値段設定。と
 * カテゴリの増減」)。ホーム表示(show_on_home)も同じ理由でここに置く。
 */

import { useActionState, useState } from 'react';

import type { Genre } from '@/features/genre/store';
import {
  createGenreAction,
  deleteGenreAction,
  setGenreShowOnHomeAction,
  updateGenreBudgetAction,
} from './actions';

const INITIAL_STATE: { error: string | null } = { error: null };

export function GenreManageCard({ genres }: { genres: readonly Genre[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="glass rounded-[22px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3"
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          ジャンルを管理する
        </h2>
        <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
          {open ? '閉じる' : `${genres.length}件`}
        </span>
      </button>

      {open ? (
        <div className="mt-3 space-y-3">
          <ul className="space-y-2">
            {genres.map((genre) => (
              <GenreListItem key={genre.id} genre={genre} />
            ))}
          </ul>
          <NewGenreForm />
        </div>
      ) : null}
    </div>
  );
}

function GenreListItem({ genre }: { genre: Genre }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState(
    genre.budgetYen === null ? '' : String(genre.budgetYen),
  );
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [showOnHome, setShowOnHome] = useState(genre.showOnHome);
  const [showOnHomeSaving, setShowOnHomeSaving] = useState(false);

  const handleDelete = async () => {
    setPending(true);
    const result = await deleteGenreAction(genre.id);
    setPending(false);
    if (result.error !== null) setError(result.error);
  };

  const handleBudgetBlur = async () => {
    const current = genre.budgetYen === null ? '' : String(genre.budgetYen);
    if (budgetInput === current) return;
    setBudgetSaving(true);
    const result = await updateGenreBudgetAction(genre.id, budgetInput);
    setBudgetSaving(false);
    if (result.error !== null) {
      setError(result.error);
      setBudgetInput(current);
      return;
    }
    setError(null);
  };

  const handleToggleShowOnHome = async () => {
    const next = !showOnHome;
    setShowOnHome(next);
    setShowOnHomeSaving(true);
    const result = await setGenreShowOnHomeAction(genre.id, next);
    setShowOnHomeSaving(false);
    if (result.error !== null) {
      setError(result.error);
      setShowOnHome(!next);
    }
  };

  return (
    <li>
      <div className="space-y-2 rounded-xl px-3 py-2" style={{ background: 'var(--plane)' }}>
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-sm" style={{ color: 'var(--ink)' }}>
            {genre.name}
          </span>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={pending}
            className="shrink-0 text-xs font-semibold disabled:opacity-40"
            style={{ color: 'var(--over)' }}
          >
            {pending ? '削除中…' : '削除'}
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* 本人発案「ユーザーが設定するのはカテゴリのそれぞれの値段設定」。
              空欄は無制限(budget_yen=null)。 */}
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
            <span className="shrink-0" style={{ color: 'var(--ink-muted)' }}>
              予算
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={() => void handleBudgetBlur()}
              disabled={budgetSaving}
              placeholder="無制限"
              className="min-w-0 flex-1 rounded-lg px-2 py-1 text-xs"
              style={{
                background: 'var(--surface)',
                color: 'var(--ink)',
                border: '1px solid var(--hairline)',
              }}
            />
            <span className="shrink-0" style={{ color: 'var(--ink-muted)' }}>
              円/月
            </span>
          </label>

          <label
            className="flex shrink-0 items-center gap-1 text-xs"
            style={{ color: 'var(--ink-muted)' }}
          >
            <input
              type="checkbox"
              checked={showOnHome}
              onChange={() => void handleToggleShowOnHome()}
              disabled={showOnHomeSaving}
            />
            ホームに表示
          </label>
        </div>
      </div>
      {error ? (
        <p className="mt-1 text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </li>
  );
}

function NewGenreForm() {
  const [state, formAction, pending] = useActionState(createGenreAction, INITIAL_STATE);

  return (
    <form action={formAction}>
      <div className="flex gap-2">
        <input
          name="name"
          placeholder="新しいジャンル名"
          required
          className="min-w-0 flex-1 rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--action)', color: 'var(--on-action)' }}
        >
          {pending ? '追加中…' : '追加'}
        </button>
      </div>
      {state.error ? (
        <p className="mt-2 text-xs" style={{ color: 'var(--over)' }}>
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
