'use client';

import { useActionState } from 'react';

import type { MilestonePhase } from '@/features/job-change/store';
import { createMilestoneAction, type MilestoneFormState } from './actions';

const PHASE_LABEL: Record<MilestonePhase, string> = {
  research: '市場調査',
  resume: '職務経歴書',
  apply: '応募',
  interview: '面接',
  offer: '内定',
};

const INITIAL_STATE: MilestoneFormState = { error: null };

export function NewMilestoneForm({ defaultPhase }: { defaultPhase: MilestonePhase }) {
  const [state, formAction, pending] = useActionState(createMilestoneAction, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-2">
      <div className="flex gap-2">
        <select
          name="phase"
          defaultValue={defaultPhase}
          className="rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        >
          {(Object.keys(PHASE_LABEL) as MilestonePhase[]).map((phase) => (
            <option key={phase} value={phase}>
              {PHASE_LABEL[phase]}
            </option>
          ))}
        </select>
        <input
          type="text"
          name="title"
          required
          placeholder="項目名(例:応募書類を3社分作る)"
          className="min-w-0 flex-1 rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />
      </div>
      <input
        type="date"
        name="dueOn"
        className="w-full rounded-xl px-3 py-2 text-sm"
        style={{
          background: 'var(--plane)',
          color: 'var(--ink)',
          border: '1px solid var(--hairline)',
        }}
      />

      {state.error ? (
        <p className="text-xs" style={{ color: 'var(--over)' }}>
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full py-2.5 text-sm font-semibold disabled:opacity-50"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        {pending ? '追加しています…' : '追加する'}
      </button>
    </form>
  );
}
