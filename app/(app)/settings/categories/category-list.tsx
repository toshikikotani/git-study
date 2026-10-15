'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { GenreBadge } from '@/components/ui/genre-badge';
import { hapticFor } from '@/lib/haptics';
import { createCategoryAction, setCategoryShowOnHomeAction } from '../../spending/category/actions';

type Category = { id: string; name: string; showOnHome: boolean };

export function CategoryList({ categories }: { categories: readonly Category[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (name.trim() === '') return;
    setAdding(true);
    setError(null);
    const result = await createCategoryAction(name);
    setAdding(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    hapticFor('save');
    setName('');
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <ul
        className="glass divider-list rounded-[28px] px-4"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        {categories.map((c) => (
          <CategoryRow key={c.id} category={c} />
        ))}
      </ul>

      <section
        aria-labelledby="add-category"
        className="glass space-y-2 rounded-[28px] p-4"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <h2 id="add-category" className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          カテゴリを追加
        </h2>
        <div className="flex gap-2">
          <input
            aria-labelledby="add-category"
            value={name}
            maxLength={20}
            placeholder="新しいカテゴリ名"
            onChange={(e) => setName(e.target.value)}
            className="min-h-11 min-w-0 flex-1 rounded-xl px-3 text-base"
            style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
          />
          <button
            type="button"
            disabled={adding || name.trim() === ''}
            onClick={() => void add()}
            className="min-h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--action)', color: 'var(--on-action)' }}
          >
            {adding ? '追加しています' : '追加'}
          </button>
        </div>
        {error ? (
          <p role="alert" className="text-xs" style={{ color: 'var(--over)' }}>
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function CategoryRow({ category }: { category: Category }) {
  const [showOnHome, setShowOnHome] = useState(category.showOnHome);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleHome = async () => {
    const next = !showOnHome;
    setShowOnHome(next);
    setSaving(true);
    const result = await setCategoryShowOnHomeAction(category.id, next);
    setSaving(false);
    if (result.error !== null) {
      setShowOnHome(!next);
      setError(result.error);
      return;
    }
    setError(null);
  };

  return (
    <li className="py-1">
      <div className="flex items-center gap-2">
        <Link
          href={`/settings/categories/${category.id}` as Route}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-3"
        >
          <GenreBadge name={category.name} size={28} />
          <span className="truncate text-sm" style={{ color: 'var(--ink)' }}>
            {category.name}
          </span>
          <span aria-hidden className="ml-auto text-sm" style={{ color: 'var(--ink-muted)' }}>
            ›
          </span>
        </Link>
        <button
          type="button"
          role="switch"
          aria-checked={showOnHome}
          aria-label={`${category.name}をホームに表示`}
          disabled={saving}
          onClick={() => void toggleHome()}
          className="min-h-11 shrink-0 rounded-full px-3 text-xs font-semibold"
          style={{
            background: showOnHome ? 'var(--accent-track)' : 'var(--surface-raised)',
            color: showOnHome ? 'var(--ink)' : 'var(--ink-muted)',
          }}
        >
          {showOnHome ? 'ホームに表示' : 'ホームに出さない'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="pb-1 text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </li>
  );
}
