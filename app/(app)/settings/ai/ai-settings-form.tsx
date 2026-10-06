'use client';

import { useActionState } from 'react';

import { updateAiSettingsAction, type AiSettingsFormState } from './actions';

const INITIAL_STATE: AiSettingsFormState = { error: null, saved: false };

export function AiSettingsForm({ aiEnabled }: { aiEnabled: boolean }) {
  const [state, formAction, pending] = useActionState(updateAiSettingsAction, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-4">
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
          AI機能を使う
        </span>
        <input
          type="checkbox"
          role="switch"
          name="aiEnabled"
          defaultChecked={aiEnabled}
          aria-label="AI機能を使う"
          className="size-5"
        />
      </label>

      {state.error ? (
        <p className="text-xs" style={{ color: 'var(--over)' }}>
          {state.error}
        </p>
      ) : null}
      {state.saved ? (
        <p className="text-xs" style={{ color: 'var(--income)' }}>
          保存しました
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-2xl py-3 text-sm font-medium text-white disabled:opacity-50"
        style={{ background: 'var(--action)' }}
      >
        {pending ? '保存しています…' : '保存する'}
      </button>
    </form>
  );
}
