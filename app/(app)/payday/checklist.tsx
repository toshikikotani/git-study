'use client';

import { useActionState } from 'react';

import { Card } from '@/components/ui/card';
import { formatYen } from '@/domain/money';
import type { TransferRun } from '@/features/transfer-runs/store';
import { formatDateJa, type DateOnly } from '@/lib/date';
import {
  createPaydayRunAction,
  toggleTransferRunItemAction,
  type PaydayChecklistFormState,
} from './checklist-actions';

const INITIAL_STATE: PaydayChecklistFormState = { error: null };

/** 今月分の入金額がまだ無い状態。入力してもらって初めてチェックリストが作られる。 */
export function PaydayAmountForm({ paydayOn }: { paydayOn: DateOnly }) {
  const [state, formAction, pending] = useActionState(
    createPaydayRunAction.bind(null, paydayOn),
    INITIAL_STATE,
  );

  return (
    <Card>
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        給料日({formatDateJa(paydayOn)})が来ました
      </h2>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        いくら入金されましたか?この金額をもとに、下のルールで振り分けます。
      </p>

      <form action={formAction} className="mt-3 flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          name="sourceAmountYen"
          placeholder="300000"
          className="min-w-0 flex-1 rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {pending ? '作成中…' : '振り分ける'}
        </button>
      </form>

      {state.error ? (
        <p className="mt-2 text-xs" style={{ color: 'var(--over)' }}>
          {state.error}
        </p>
      ) : null}
    </Card>
  );
}

/** 実行中のチェックリスト。上から消化する(FR-15)。 */
export function PaydayChecklist({ run }: { run: TransferRun }) {
  const doneCount = run.items.filter((i) => i.isDone).length;

  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          給料日チェックリスト({formatDateJa(run.runOn)})
        </h2>
        <span className="tabular text-xs" style={{ color: 'var(--ink-muted)' }}>
          {doneCount} / {run.items.length}
        </span>
      </div>
      <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
        入金額 {formatYen(run.sourceAmountYen, { sign: 'never' })}。上から順に済ませてください。
      </p>

      <ul className="mt-3 space-y-2">
        {run.items.map((item) => (
          <li key={item.id}>
            <form action={toggleTransferRunItemAction.bind(null, item.id, !item.isDone)}>
              <button
                type="submit"
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left"
                style={{
                  background: item.isDone ? 'var(--accent-track)' : 'var(--plane)',
                  border: '1px solid var(--hairline)',
                }}
              >
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                  style={{
                    background: item.isDone ? 'var(--accent)' : 'transparent',
                    border: item.isDone ? 'none' : '1px solid var(--hairline)',
                    color: '#fff',
                  }}
                >
                  {item.isDone ? '✓' : ''}
                </span>
                <span
                  className="flex-1 text-sm"
                  style={{
                    color: item.isDone ? 'var(--ink-muted)' : 'var(--ink)',
                    textDecoration: item.isDone ? 'line-through' : 'none',
                  }}
                >
                  {item.label}
                </span>
                <span
                  className="tabular text-sm font-medium"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  {formatYen(item.plannedAmountYen, { sign: 'never' })}
                </span>
              </button>
            </form>
          </li>
        ))}
      </ul>

      {doneCount === run.items.length ? (
        <p className="mt-3 text-xs" style={{ color: 'var(--accent)' }}>
          完了しました。次の給料日まで再表示されません。
        </p>
      ) : null}
    </Card>
  );
}
