'use client';

import { useActionState, useState } from 'react';

import { Card } from '@/components/ui/card';
import { formatYen } from '@/domain/money';
import type { Category } from '@/features/categories/store';
import { mergeCategoryAction, updateCategoryAction, type CategoryFormState } from './actions';
import { CategoryForm } from './category-form';
import { CATEGORY_KIND_LABELS } from './category-kind-labels';

type Mode = 'view' | 'edit' | 'merge';

/** 一覧の1件。読み取り表示・編集フォーム・統合フォームをこの中で切り替える(M2-6)。 */
export function CategoryRow({
  category,
  categories,
}: {
  category: Category;
  /** 統合先の選択肢・統合済みカテゴリの行き先表示に使う全カテゴリ。 */
  categories: readonly Category[];
}) {
  const [mode, setMode] = useState<Mode>('view');

  const mergeTargets = categories.filter((c) => c.isActive && c.id !== category.id);
  const mergedIntoName = category.mergedIntoId
    ? (categories.find((c) => c.id === category.mergedIntoId)?.name ?? null)
    : null;

  if (mode === 'edit') {
    return (
      <Card>
        <CategoryForm
          action={updateCategoryAction.bind(null, category.id)}
          initial={category}
          submitLabel="更新する"
          onDone={() => setMode('view')}
        />
      </Card>
    );
  }

  if (mode === 'merge') {
    return (
      <Card>
        <MergeForm
          category={category}
          targets={mergeTargets}
          onDone={() => setMode('view')}
          onCancel={() => setMode('view')}
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3
            className="text-sm font-semibold"
            style={{ color: category.isActive ? 'var(--ink)' : 'var(--ink-muted)' }}
          >
            {category.name}
          </h3>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {CATEGORY_KIND_LABELS[category.kind]}
            {category.budgetYen !== null ? ` ・ 月次予算 ${formatYen(category.budgetYen)}` : ''}
            {category.showOnHome ? ' ・ ホーム表示' : ''}
          </p>
          {mergedIntoName ? (
            <p className="mt-1 text-xs font-medium" style={{ color: 'var(--accent)' }}>
              「{mergedIntoName}」に統合済み
            </p>
          ) : null}
        </div>

        {category.isActive ? (
          <div className="flex shrink-0 gap-3">
            <button
              type="button"
              onClick={() => setMode('edit')}
              className="text-xs font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              編集
            </button>
            {!category.isSystem && mergeTargets.length > 0 ? (
              <button
                type="button"
                onClick={() => setMode('merge')}
                className="text-xs font-semibold"
                style={{ color: 'var(--ink-muted)' }}
              >
                統合
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

const MERGE_INITIAL_STATE: CategoryFormState = { error: null };

function MergeForm({
  category,
  targets,
  onDone,
  onCancel,
}: {
  category: Category;
  targets: readonly Category[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    async (prev: CategoryFormState, fd: FormData) => {
      const result = await mergeCategoryAction(category.id, prev, fd);
      if (result.error === null) onDone();
      return result;
    },
    MERGE_INITIAL_STATE,
  );

  return (
    <form action={formAction} className="space-y-3">
      <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
        「{category.name}」を統合する
      </p>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        統合すると「{category.name}」は無効になり、これまでの明細は統合先のカテゴリで集計されます。
      </p>

      <select
        name="mergedIntoId"
        defaultValue=""
        required
        className="w-full rounded-xl px-3 py-2 text-sm"
        style={{
          background: 'var(--plane)',
          color: 'var(--ink)',
          border: '1px solid var(--hairline)',
        }}
      >
        <option value="" disabled>
          統合先を選ぶ
        </option>
        {targets.map((target) => (
          <option key={target.id} value={target.id}>
            {target.name}
          </option>
        ))}
      </select>

      {state.error ? (
        <p className="text-xs" style={{ color: 'var(--over)' }}>
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-full py-2.5 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--over)', color: '#fff' }}
        >
          {pending ? '統合しています…' : '統合する'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-4 py-2.5 text-sm font-medium"
          style={{ color: 'var(--ink-muted)' }}
        >
          やめる
        </button>
      </div>
    </form>
  );
}
