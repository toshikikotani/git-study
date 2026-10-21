'use client';

import { useActionState, useState } from 'react';

import { Card } from '@/components/ui/card';
import { createGoalAction, type GoalFormState } from './actions';

const INITIAL_STATE: GoalFormState = { error: null };

const INPUT_STYLE = {
  background: 'var(--plane)',
  color: 'var(--ink)',
  border: '1px solid var(--hairline)',
} as const;

/** 貯金目標を作る(何のために・いくら・いつまでに)。 */
export function NewGoal() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: GoalFormState, fd: FormData) => {
    const result = await createGoalAction(prev, fd);
    if (result.error === null) setOpen(false);
    return result;
  }, INITIAL_STATE);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 w-full rounded-full py-3 text-sm font-semibold"
        style={{ ...INPUT_STYLE, color: 'var(--accent)' }}
      >
        + 何のために貯めるか(任意)
      </button>
    );
  }

  return (
    <Card>
      <form action={formAction} className="space-y-3">
        <Field label="何のために">
          <input
            name="title"
            type="text"
            required
            placeholder="旅行・引っ越し・もしものとき など"
            className="w-full rounded-xl px-3 py-2 text-sm"
            style={INPUT_STYLE}
          />
        </Field>
        <Field label="いくら(円・任意)">
          <input
            name="targetAmountYen"
            type="text"
            inputMode="numeric"
            className="w-full rounded-xl px-3 py-2 text-sm"
            style={INPUT_STYLE}
          />
        </Field>
        <Field label="いつまでに(任意)">
          <input
            name="targetDate"
            type="date"
            className="w-full rounded-xl px-3 py-2 text-sm"
            style={INPUT_STYLE}
          />
        </Field>

        {state.error ? (
          <p className="text-xs" style={{ color: 'var(--over)' }}>
            {state.error}
          </p>
        ) : null}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 btn-primary flex-1 rounded-full py-3 text-sm font-semibold"
          >
            {pending ? '保存中…' : 'つくる'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-11 rounded-full px-4 py-3 text-sm font-semibold"
            style={{ color: 'var(--ink-muted)' }}
          >
            やめる
          </button>
        </div>
      </form>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
