'use client';

import { useActionState, useMemo, useState } from 'react';

import { Card } from '@/components/ui/card';
import { computeIncomeAllocation } from '@/domain/side-hustle';
import { formatYen, parseYen } from '@/domain/money';
import type { SideIncome, SideProject } from '@/features/side-hustle/store';
import { formatDateJa, todayJst } from '@/lib/date';
import { createIncomeAction, type SideHustleFormState } from './actions';

const INITIAL_STATE: SideHustleFormState = { error: null };

/** 入金の記録と、貯金:投資への自動振り分け(FR-42)。 */
export function IncomeSection({
  projects,
  incomes,
  savingsRatio,
}: {
  projects: readonly SideProject[];
  incomes: readonly SideIncome[];
  savingsRatio: number;
}) {
  const [adding, setAdding] = useState(false);
  const projectName = (id: string | null) =>
    id === null ? '(未指定)' : (projects.find((p) => p.id === id)?.name ?? '(削除済み)');

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-secondary)' }}>
        入金の記録
      </h2>
      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        入金額を貯金:投資 = {Math.round(savingsRatio * 100)}:{Math.round((1 - savingsRatio) * 100)}{' '}
        で自動的に振り分けます。実際の資金移動は 本人が手動で行ってください。
      </p>

      {incomes.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
          まだ記録がありません。
        </p>
      ) : (
        <div className="space-y-2">
          {incomes.slice(0, 5).map((income) => (
            <Card key={income.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    {projectName(income.projectId)}
                  </p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {formatDateJa(income.receivedOn)}
                  </p>
                  {income.allocatedToSavingsYen !== null ? (
                    <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
                      貯金へ {formatYen(income.allocatedToSavingsYen, { sign: 'never' })}
                      ・投資へ {formatYen(income.allocatedToInvestmentYen ?? 0, { sign: 'never' })}
                    </p>
                  ) : null}
                </div>
                <span
                  className="tabular shrink-0 text-sm font-semibold"
                  style={{ color: 'var(--ink)' }}
                >
                  {formatYen(income.amountYen, { sign: 'never' })}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {adding ? (
        <Card>
          <IncomeForm
            projects={projects}
            savingsRatio={savingsRatio}
            onDone={() => setAdding(false)}
          />
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
          + 入金を記録
        </button>
      )}
    </section>
  );
}

function IncomeForm({
  projects,
  savingsRatio,
  onDone,
}: {
  projects: readonly SideProject[];
  savingsRatio: number;
  onDone: () => void;
}) {
  const [amountText, setAmountText] = useState('');
  const [state, formAction, pending] = useActionState(
    async (prev: SideHustleFormState, fd: FormData) => {
      const result = await createIncomeAction(prev, fd);
      if (result.error === null) onDone();
      return result;
    },
    INITIAL_STATE,
  );

  const preview = useMemo(() => {
    try {
      const amountYen = parseYen(amountText);
      if (amountYen <= 0) return null;
      return computeIncomeAllocation(amountYen, savingsRatio);
    } catch {
      return null;
    }
  }, [amountText, savingsRatio]);

  return (
    <form action={formAction} className="space-y-3">
      <Field label="プロジェクト(任意)">
        <select
          name="projectId"
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        >
          <option value="">(未指定)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="入金日">
        <input
          type="date"
          name="receivedOn"
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
      <Field label="入金額(円)">
        <input
          name="amountYen"
          type="text"
          inputMode="numeric"
          required
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />
      </Field>

      {preview ? (
        <p className="text-xs" style={{ color: 'var(--accent)' }}>
          貯金へ {formatYen(preview.savingsYen, { sign: 'never' })}・投資へ{' '}
          {formatYen(preview.investmentYen, { sign: 'never' })}
        </p>
      ) : null}

      <Field label="メモ(任意)">
        <input
          name="note"
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
          className="flex-1 rounded-full py-3 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--action)', color: 'var(--on-action)' }}
        >
          {pending ? '保存中…' : '記録する'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-full px-4 py-3 text-sm font-medium"
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
