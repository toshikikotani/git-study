'use client';

import { useActionState, useState } from 'react';

import { Card } from '@/components/ui/card';
import { formatYen } from '@/domain/money';
import type { SideProject } from '@/features/side-hustle/store';
import { createProjectAction, type SideHustleFormState } from './actions';

const INITIAL_STATE: SideHustleFormState = { error: null };

export type ProjectSummary = {
  project: SideProject;
  totalMinutes: number;
  hourlyRateYen: number | null;
};

/** プロジェクト一覧と時給換算(FR-40)。 */
export function ProjectSection({ summaries }: { summaries: readonly ProjectSummary[] }) {
  const [adding, setAdding] = useState(false);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-secondary)' }}>
        プロジェクト
      </h2>

      {summaries.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
          まだプロジェクトがありません。
        </p>
      ) : (
        <div className="space-y-2">
          {summaries.map(({ project, totalMinutes, hourlyRateYen }) => (
            <Card key={project.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    {project.name}
                  </p>
                  <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {project.clientName ?? project.kind ?? '個人開発'}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tabular text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                    {hourlyRateYen === null
                      ? '—'
                      : `${formatYen(hourlyRateYen, { sign: 'never' })}/時`}
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    合計 {Math.round((totalMinutes / 60) * 10) / 10} 時間
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {adding ? (
        <Card>
          <ProjectForm onDone={() => setAdding(false)} />
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
          + プロジェクトを追加
        </button>
      )}
    </section>
  );
}

function ProjectForm({ onDone }: { onDone: () => void }) {
  const [state, formAction, pending] = useActionState(
    async (prev: SideHustleFormState, fd: FormData) => {
      const result = await createProjectAction(prev, fd);
      if (result.error === null) onDone();
      return result;
    },
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="space-y-3">
      <Field label="プロジェクト名">
        <input
          name="name"
          type="text"
          required
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />
      </Field>
      <Field label="クライアント名(任意)">
        <input
          name="clientName"
          type="text"
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />
      </Field>
      <Field label="種別(任意、例:受託・自社サービス)">
        <input
          name="kind"
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
          {pending ? '保存中…' : '追加する'}
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
