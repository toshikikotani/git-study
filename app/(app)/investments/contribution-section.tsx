'use client';

import { useActionState, useState } from 'react';

import { Card } from '@/components/ui/card';
import { formatYen } from '@/domain/money';
import type { InvestmentContribution } from '@/features/investments/store';
import { formatDateJa, todayJst } from '@/lib/date';
import { createContributionAction, type InvestmentFormState } from './actions';

const INITIAL_STATE: InvestmentFormState = { error: null };

/** 拠出(フロー)の一覧と記録フォーム(M7-2、FR-51)。 */
export function ContributionSection({
  contributions,
}: {
  contributions: readonly InvestmentContribution[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-secondary)' }}>
        拠出の記録
      </h2>

      {contributions.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
          まだ記録がありません。
        </p>
      ) : (
        <div className="space-y-2">
          {contributions.map((contribution) => (
            <Card key={contribution.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    {contribution.productName ?? '(商品未指定)'}
                    {contribution.isHighRisk ? (
                      <span
                        className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
                      >
                        高リスク枠
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {formatDateJa(contribution.contributedOn)}
                  </p>
                  {contribution.note ? (
                    <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
                      {contribution.note}
                    </p>
                  ) : null}
                </div>
                <span
                  className="tabular shrink-0 text-sm font-semibold"
                  style={{ color: 'var(--ink)' }}
                >
                  {formatYen(contribution.amountYen, { sign: 'never' })}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {adding ? (
        <Card>
          <ContributionForm onDone={() => setAdding(false)} />
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
          + 拠出を記録
        </button>
      )}
    </section>
  );
}

function ContributionForm({ onDone }: { onDone: () => void }) {
  const [state, formAction, pending] = useActionState(
    async (prev: InvestmentFormState, fd: FormData) => {
      const result = await createContributionAction(prev, fd);
      if (result.error === null) onDone();
      return result;
    },
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="space-y-3">
      <Field label="拠出日">
        <input
          type="date"
          name="contributedOn"
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

      <Field label="拠出額(円)">
        <input
          name="amountYen"
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

      <Field label="商品名(任意)">
        <input
          name="productName"
          type="text"
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />
      </Field>

      <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-secondary)' }}>
        <input type="checkbox" name="isHighRisk" />
        高リスク枠への拠出
      </label>

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
