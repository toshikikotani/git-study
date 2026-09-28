'use client';

/**
 * ジャンルの一覧管理(本人発案「カテゴリはdbに保存してenumじゃなくて、
 * 自由に変更できる仕組みに。追加削除容易にしたい」、ADR-056)。
 *
 * /rules の NewCategory・CategoryRow と同じ構成だが、ジャンルは kind・予算・
 * 統合を持たないため名前だけのシンプルな追加・削除に絞った。
 */

import { useActionState, useState } from 'react';

import type { Genre } from '@/features/genre/store';
import { createGenreAction, deleteGenreAction } from './actions';

const INITIAL_STATE: { error: string | null } = { error: null };

export function GenreManageCard({ genres }: { genres: readonly Genre[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="rounded-[22px] p-5"
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
          <ul className="space-y-1.5">
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

  const handleDelete = async () => {
    setPending(true);
    const result = await deleteGenreAction(genre.id);
    setPending(false);
    if (result.error !== null) setError(result.error);
  };

  return (
    <li>
      <div
        className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
        style={{ background: 'var(--plane)' }}
      >
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
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {pending ? '追加中…' : '追加'}
        </button>
      </div>
      {state.error ? (
        <p className="mt-1.5 text-xs" style={{ color: 'var(--over)' }}>
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
