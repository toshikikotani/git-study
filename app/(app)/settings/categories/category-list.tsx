'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';

import { GenreBadge } from '@/components/ui/genre-badge';
import { BackHeader } from '@/components/ui/back-header';
import type { BackTarget } from '@/lib/back-target';
import { similarCategories } from '@/domain/genre-similarity';
import { hapticFor } from '@/lib/haptics';
import { ChevronRightIcon } from '@/components/ui/nav-icons';
import {
  createCategoryAction,
  mergeCategoryAction,
  reorderCategoriesAction,
} from '../../spending/category/actions';

type Category = { id: string; name: string };

/**
 * カテゴリの一覧(デザイン仕様書の「カテゴリの設定」、ADR-090 → 113):1行に押せる所は1つ(名前を押すと
 * そのカテゴリの設定)。「並べ替え」で上下の順を変え、「完了」で保存。いちばん下で追加できる。
 * 以前は「ホームに表示」と「そのほか」に分け、22行すべてにスイッチを置いていた。一覧がオン・オフの設定画面に
 * 見え、名前とスイッチを押し間違えやすく、月ごとに入れ替える手間も要った(本人の指摘)。ホームの
 * 「気をつけたいカテゴリ」はいまは自動で選ぶ(ADR-117)。
 */
export function CategoryList({
  categories,
  back,
}: {
  categories: readonly Category[];
  back: BackTarget;
}) {
  const [items, setItems] = useState<readonly Category[]>(categories);
  // 保存のあとはサーバーから新しい一覧が届く(アクションの返事に画面の作り直しが入る)。届いたら入れ替える。
  const [source, setSource] = useState(categories);
  if (source !== categories) {
    setSource(categories);
    setItems(categories);
  }
  const [sorting, setSorting] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const similar = similarCategories(items);

  const add = async () => {
    if (name.trim() === '') return;
    setBusy(true);
    setError(null);
    const result = await createCategoryAction(name);
    setBusy(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    hapticFor('save');
    setName('');
  };

  const move = (id: string, delta: -1 | 1) => {
    setItems((prev) => {
      const i = prev.findIndex((p) => p.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };

  const finishSorting = async () => {
    setBusy(true);
    const result = await reorderCategoriesAction(items.map((c) => c.id));
    setBusy(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    setSorting(false);
  };

  const merge = async (from: Category, into: { id: string; name: string }) => {
    setBusy(true);
    setError(null);
    const result = await mergeCategoryAction(from.id, into.id);
    setBusy(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    setItems((prev) => prev.filter((p) => p.id !== from.id));
  };

  const rows = (list: readonly Category[]) =>
    list.map((c, i) => (
      <Row
        key={c.id}
        category={c}
        first={i === 0}
        sorting={sorting}
        similar={similar.get(c.id) ?? null}
        busy={busy}
        onMove={(delta) => move(c.id, delta)}
        onMerge={(into) => void merge(c, into)}
      />
    ));

  return (
    <>
      <BackHeader
        back={back}
        title="カテゴリ"
        sub="名前をタップすると、アイコン・色・目標額・固定費を変えられます。"
        action={
          <button
            type="button"
            onClick={() => (sorting ? void finishSorting() : setSorting(true))}
            disabled={busy}
            className={`flex min-h-11 items-center px-1 text-[17px] disabled:opacity-40 ${sorting ? 'font-semibold' : ''}`}
            style={{ color: 'var(--accent)' }}
          >
            {sorting ? '完了' : '並べ替え'}
          </button>
        }
      />
      {error ? (
        <p role="alert" className="px-4 text-[13px]" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}

      <Caption>カテゴリ · {items.length}</Caption>
      <ul className="flex flex-col rounded-2xl" style={{ background: 'var(--surface)' }}>
        {rows(items)}
        <li style={items.length > 0 ? { borderTop: '1px solid var(--hairline)' } : undefined}>
          <label className="flex min-h-14 items-center gap-3 px-4">
            <span
              aria-hidden
              className="btn-primary flex size-8 shrink-0 items-center justify-center rounded-full"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className="sr-only">新しいカテゴリ名</span>
            <input
              value={name}
              maxLength={20}
              placeholder="カテゴリを追加"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add();
              }}
              className="min-w-0 flex-1 bg-transparent text-[16px] outline-none"
              style={{ color: 'var(--ink)' }}
            />
            {name.trim() !== '' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void add()}
                className="min-h-11 px-2 text-[15px] font-semibold disabled:opacity-40"
                style={{ color: 'var(--accent)' }}
              >
                追加
              </button>
            ) : null}
          </label>
        </li>
      </ul>
    </>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-4 pt-3 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
      {children}
    </span>
  );
}

function Row({
  category,
  first,
  sorting,
  similar,
  busy,
  onMove,
  onMerge,
}: {
  category: Category;
  first: boolean;
  sorting: boolean;
  similar: { id: string; name: string } | null;
  busy: boolean;
  onMove: (delta: -1 | 1) => void;
  onMerge: (into: { id: string; name: string }) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li
      className="flex flex-col"
      style={first ? undefined : { borderTop: '1px solid var(--hairline)' }}
    >
      <div className="flex min-h-14 items-center gap-3 px-4">
        <Link
          href={`/settings/categories/${category.id}` as Route}
          className="flex min-h-13 min-w-0 flex-1 items-center gap-3"
          style={{ color: 'var(--ink)' }}
        >
          <GenreBadge name={category.name} size={32} />
          <span className="min-w-0 flex-1 truncate text-[16px]">{category.name}</span>
          {sorting ? null : (
            <span aria-hidden style={{ color: 'var(--ink-muted)' }}>
              <ChevronRightIcon />
            </span>
          )}
        </Link>
        {sorting ? (
          <span className="flex shrink-0 gap-1">
            <SortButton
              label={`${category.name}を上へ`}
              d="M6 15l6-6 6 6"
              onClick={() => onMove(-1)}
            />
            <SortButton
              label={`${category.name}を下へ`}
              d="M6 9l6 6 6-6"
              onClick={() => onMove(1)}
            />
          </span>
        ) : null}
      </div>
      {similar && !sorting ? (
        <div
          className="mr-4 mb-3 ml-16 flex items-center justify-between gap-2 rounded-xl py-1 pr-1 pl-3"
          style={{ background: 'var(--state-caution-track)' }}
        >
          <span className="text-[13px]" style={{ color: 'var(--state-caution)' }}>
            {confirming ? `「${similar.name}」へまとめますか?` : `「${similar.name}」と似ています`}
          </span>
          <span className="flex shrink-0 gap-1">
            {confirming ? (
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="min-h-11 rounded-full px-3 text-[13px]"
                style={{ color: 'var(--state-caution)' }}
              >
                やめる
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => (confirming ? onMerge(similar) : setConfirming(true))}
              className="min-h-11 rounded-full px-3 text-[13px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--surface)', color: 'var(--state-caution)' }}
            >
              まとめる
            </button>
          </span>
        </div>
      ) : null}
    </li>
  );
}

function SortButton({ label, d, onClick }: { label: string; d: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-11 min-h-11 items-center justify-center rounded-full"
      style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
    >
      <svg
        aria-hidden
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={d} />
      </svg>
    </button>
  );
}
