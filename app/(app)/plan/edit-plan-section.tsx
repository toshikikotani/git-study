'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { updatePlanAllocationAction } from './actions';
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

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-xs font-semibold"
        style={{ color: 'var(--accent)' }}
      >
        {open ? '配分の調整を閉じる' : '配分・総額を調整する'}
      </button>
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
