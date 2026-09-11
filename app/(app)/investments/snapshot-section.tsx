'use client';

import { useActionState, useState } from 'react';

import { Card } from '@/components/ui/card';
import { formatYen } from '@/domain/money';
import type { InvestmentSnapshot } from '@/features/investments/store';
import { formatDateJa, todayJst } from '@/lib/date';
import { upsertSnapshotAction, type InvestmentFormState } from './actions';

const INITIAL_STATE: InvestmentFormState = { error: null };

/** 残高(ストック)の一覧と記録フォーム(M7-2、FR-51)。同じ日・同じ商品は上書きされる(DoD)。 */
export function SnapshotSection({ snapshots }: { snapshots: readonly InvestmentSnapshot[] }) {
  const [adding, setAdding] = useState(false);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-secondary)' }}>
        残高の記録
      </h2>

      {snapshots.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
          まだ記録がありません。
        </p>
      ) : (
        <div className="space-y-2">
          {snapshots.map((snapshot) => (
            <Card key={snapshot.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    {snapshot.productName}
                  </p>
                  <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {formatDateJa(snapshot.asOf)} 時点
                    {snapshot.costBasisYen !== null
                      ? ` ・ 取得額 ${formatYen(snapshot.costBasisYen, { sign: 'never' })}`
                      : ''}
                  </p>
                </div>
                <span
                  className="tabular shrink-0 text-sm font-semibold"
                  style={{ color: 'var(--ink)' }}
                >
                  {formatYen(snapshot.marketValueYen, { sign: 'never' })}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {adding ? (
        <Card>
          <SnapshotForm onDone={() => setAdding(false)} />
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
          + 残高を記録
        </button>
      )}
    </section>
  );
}

function SnapshotForm({ onDone }: { onDone: () => void }) {
  const [state, formAction, pending] = useActionState(
    async (prev: InvestmentFormState, fd: FormData) => {
      const result = await upsertSnapshotAction(prev, fd);
      if (result.error === null) onDone();
      return result;
    },
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="space-y-3">
      <Field label="時点" hint="同じ日・同じ商品名で記録すると上書きされます">
        <input
          type="date"
          name="asOf"
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

      <Field label="商品名">
        <input
          name="productName"
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

      <Field label="残高(円)">
        <input
          name="marketValueYen"
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

      <Field label="取得額(円・任意)">
        <input
          name="costBasisYen"
          type="text"
          inputMode="numeric"
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
