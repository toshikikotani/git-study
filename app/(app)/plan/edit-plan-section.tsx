'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { updatePlanAllocationAction, updatePlanPeriodAction } from './actions';
import { AllocationEditor, type AllocationRow } from './allocation-editor';

/** 保存済みの目標の配分を、総額固定のまま直す(手動・AI相談)。 */
export function EditPlanSection({
  planId,
  periodStart,
  periodEnd,
  rows,
}: {
  planId: string;
  periodStart: string;
  periodEnd: string;
  rows: readonly AllocationRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editPeriod, setEditPeriod] = useState(false);
  const [start, setStart] = useState(periodStart);
  const [end, setEnd] = useState(periodEnd);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savePeriod = async () => {
    setSaving(true);
    setError(null);
    const result = await updatePlanPeriodAction(planId, start, end);
    setSaving(false);
    if (result.error) {
      setError(result.error);
    } else {
      setEditPeriod(false);
      router.refresh();
    }
  };

  return (
    <div>
      <div className="flex gap-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="min-h-11 text-xs font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          {open ? '配分の調整を閉じる' : '配分・総額を調整する'}
        </button>
        <button
          type="button"
          onClick={() => setEditPeriod((v) => !v)}
          className="min-h-11 text-xs font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          {editPeriod ? '期間の編集を閉じる' : '期間を編集する'}
        </button>
      </div>
      {editPeriod ? (
        <div
          className="mt-3 flex flex-col gap-2 border-t pt-3"
          style={{ borderColor: 'var(--hairline)' }}
        >
          <div className="flex gap-2">
            <label className="flex flex-col gap-1 text-xs">
              開始日
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="rounded-lg border px-2 py-1"
                style={{ borderColor: 'var(--hairline)' }}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              終了日
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="rounded-lg border px-2 py-1"
                style={{ borderColor: 'var(--hairline)' }}
              />
            </label>
          </div>
          {error ? (
            <p className="text-xs" style={{ color: 'var(--state-caution)' }}>
              {error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void savePeriod()}
            disabled={saving}
            className="min-h-11 self-start rounded-full px-4 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--action)', color: 'var(--on-action)' }}
          >
            {saving ? '保存中…' : '期間を更新する'}
          </button>
        </div>
      ) : null}
      {open ? (
        <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
          <AllocationEditor
            periodStart={periodStart}
            periodEnd={periodEnd}
            rows={rows}
            saveLabel="この配分で更新する"
            onSave={async (items) => {
              const result = await updatePlanAllocationAction(planId, items);
              if (result.error === null) {
                setOpen(false);
                router.refresh();
              }
              return result;
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
