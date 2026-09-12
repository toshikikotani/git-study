'use client';

import { useActionState, useState } from 'react';

import { Card } from '@/components/ui/card';
import type { SideProject, SideWorkLog } from '@/features/side-hustle/store';
import { formatDateJa, todayJst } from '@/lib/date';
import { createWorkLogAction, type SideHustleFormState } from './actions';

const INITIAL_STATE: SideHustleFormState = { error: null };

/** 作業時間の記録(FR-40)。 */
export function WorkLogSection({
  projects,
  workLogs,
}: {
  projects: readonly SideProject[];
  workLogs: readonly SideWorkLog[];
}) {
  const [adding, setAdding] = useState(false);
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? '(削除済み)';

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-secondary)' }}>
        作業時間の記録
      </h2>

      {workLogs.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
          まだ記録がありません。
        </p>
      ) : (
        <div className="space-y-2">
          {workLogs.slice(0, 5).map((log) => (
            <Card key={log.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    {projectName(log.projectId)}
                  </p>
                  <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {formatDateJa(log.workedOn)}
                    {log.summary ? ` ・ ${log.summary}` : ''}
                  </p>
                </div>
                <span
                  className="tabular shrink-0 text-sm font-semibold"
                  style={{ color: 'var(--ink)' }}
                >
                  {Math.round((log.minutes / 60) * 10) / 10}時間
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {projects.length === 0 ? null : adding ? (
        <Card>
          <WorkLogForm projects={projects} onDone={() => setAdding(false)} />
        </Card>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="w-full rounded-full py-3 text-sm font-semibold"
          style={{
            background: 'var(--plane)',
            color: 'var(--accent)',
            border: '1px solid var(--hairline)',
          }}
        >
          + 作業時間を記録
        </button>
      )}
    </section>
  );
}

function WorkLogForm({
  projects,
  onDone,
}: {
  projects: readonly SideProject[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    async (prev: SideHustleFormState, fd: FormData) => {
      const result = await createWorkLogAction(prev, fd);
      if (result.error === null) onDone();
      return result;
    },
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="space-y-3">
      <Field label="プロジェクト">
        <select
          name="projectId"
          required
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="作業日">
        <input
          type="date"
          name="workedOn"
          defaultValue={todayJst()}
          required
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />
      </Field>
      <Field label="作業時間(分)">
        <input
          name="minutes"
          type="text"
          inputMode="numeric"
          required
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />
      </Field>
      <Field label="メモ(任意)">
        <input
          name="summary"
          type="text"
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
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
          className="flex-1 rounded-full py-2.5 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {pending ? '保存中…' : '記録する'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-full px-4 py-2.5 text-sm font-medium"
          style={{ color: 'var(--ink-muted)' }}
        >
          やめる
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
