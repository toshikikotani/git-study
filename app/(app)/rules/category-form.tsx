'use client';

import { useActionState } from 'react';

import type { Category } from '@/features/categories/store';
import type { CategoryFormState } from './actions';
import { CATEGORY_KIND_LABELS } from './category-kind-labels';

const INITIAL_STATE: CategoryFormState = { error: null };

/**
 * 新規登録・改名の両方で使う(M2-6)。
 * kind は作成後に変更できない(is_system の分岐を壊さないための UI 側の抑止)ため、
 * initial(編集時)には出さない。
 */
export function CategoryForm({
  action,
  initial,
  submitLabel,
  onDone,
}: {
  action: (prevState: CategoryFormState, formData: FormData) => Promise<CategoryFormState>;
  initial?: Category;
  submitLabel: string;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    async (prev: CategoryFormState, fd: FormData) => {
      const result = await action(prev, fd);
      if (result.error === null) onDone?.();
      return result;
    },
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="space-y-3">
      <Field label="カテゴリ名">
        <TextInput name="name" defaultValue={initial?.name} required />
      </Field>

      {!initial ? (
        <Field label="種類" hint="作成後は変更できません">
          <select
            name="kind"
            defaultValue="other"
            className="w-full rounded-xl px-3 py-2 text-sm"
            style={{
              background: 'var(--plane)',
              color: 'var(--ink)',
              border: '1px solid var(--hairline)',
            }}
          >
            {Object.entries(CATEGORY_KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <Field label="月次予算(円・任意)" hint="空欄なら上限なし">
        <input
          name="budgetYen"
          type="number"
          min={0}
          defaultValue={initial?.budgetYen ?? ''}
          required={false}
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />
      </Field>

      <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-secondary)' }}>
        <input type="checkbox" name="showOnHome" defaultChecked={initial?.showOnHome ?? false} />
        ホーム画面に残額を表示する
      </label>

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
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {pending ? '保存中…' : submitLabel}
        </button>
        {onDone ? (
          <button
            type="button"
            onClick={onDone}
            className="rounded-full px-4 py-2.5 text-sm font-medium"
            style={{ color: 'var(--ink-muted)' }}
          >
            やめる
          </button>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </span>
      <div className="mt-1">{children}</div>
      {hint ? (
        <span className="mt-1 block text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="text"
      {...props}
      className="w-full rounded-xl px-3 py-2 text-sm"
      style={{
        background: 'var(--plane)',
        color: 'var(--ink)',
        border: '1px solid var(--hairline)',
      }}
    />
  );
}
