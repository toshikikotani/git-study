'use client';

import { useState } from 'react';

import { planTotalChange } from '@/domain/spending-plan';
import { hapticFor } from '@/lib/haptics';
import { updatePlanAllocationAction } from '../../../plan/actions';

/**
 * 進行中の目標の、このカテゴリの目標額を変える。目標の総額は配分の合計なので、
 * 変えると総額も動く。保存の前に、総額がいくらからいくらになるかを確かめてもらう。
 * カテゴリ設定のシートの中でも使うため、確認はシートを重ねずにその場に出す。
 */
export function GoalTargetEdit({
  planId,
  genreId,
  rows,
}: {
  planId: string;
  genreId: string;
  rows: readonly { genreId: string; yen: number }[];
}) {
  const currentYen = rows.find((row) => row.genreId === genreId)?.yen ?? null;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [pendingYen, setPendingYen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (currentYen === null) return null;

  const change = pendingYen === null ? null : planTotalChange(rows, genreId, pendingYen);

  const startEdit = () => {
    setValue(String(currentYen));
    setError(null);
    setEditing(true);
  };

  const review = () => {
    const yen = Number(value.replace(/[,\s]/g, ''));
    if (value.trim() === '' || !Number.isInteger(yen) || yen < 0) {
      setError('0円以上の整数で入れてください');
      return;
    }
    setError(null);
    if (yen === currentYen) {
      setEditing(false);
      return;
    }
    setPendingYen(yen);
  };

  const confirm = async () => {
    if (pendingYen === null) return;
    setSaving(true);
    const result = await updatePlanAllocationAction(planId, [{ genreId, targetYen: pendingYen }]);
    setSaving(false);
    setPendingYen(null);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    hapticFor('save');
    setEditing(false);
  };

  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--surface)' }}>
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        このカテゴリの目標
      </p>
      {change !== null && pendingYen !== null ? (
        <div role="alertdialog" aria-label="目標の総額が変わります" className="mt-2 space-y-2">
          <p className="text-sm" style={{ color: 'var(--ink)' }}>
            このカテゴリの目標を {currentYen.toLocaleString()}円 から {pendingYen.toLocaleString()}
            円 にすると、目標の総額が変わります。
          </p>
          <p className="tabular text-xl font-bold" style={{ color: 'var(--ink)' }}>
            {change.beforeYen.toLocaleString()}円 → {change.afterYen.toLocaleString()}円
          </p>
          <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            ほかのカテゴリの目標はそのままです。
          </p>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setPendingYen(null)}
              disabled={saving}
              className="min-h-11 flex-1 rounded-full text-sm font-semibold"
              style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
            >
              やめる
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={saving}
              className="btn-primary min-h-11 flex-1 rounded-full text-sm font-semibold"
            >
              {saving ? '変更しています' : '変更する'}
            </button>
          </div>
        </div>
      ) : editing ? (
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            aria-label="このカテゴリの目標額(円)"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="min-h-11 min-w-0 flex-1 rounded-xl px-3 text-lg font-semibold"
            style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
          />
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="min-h-11 rounded-xl px-3 text-sm font-semibold"
            style={{ color: 'var(--ink-secondary)' }}
          >
            やめる
          </button>
          <button
            type="button"
            onClick={review}
            className="btn-primary min-h-11 rounded-xl px-4 text-sm font-semibold"
          >
            保存
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={startEdit}
          className="mt-1 flex min-h-11 items-baseline gap-2"
        >
          <span className="text-2xl font-bold" style={{ color: 'var(--ink)' }}>
            {currentYen.toLocaleString()}円
          </span>
          <span className="text-sm" style={{ color: 'var(--accent)' }}>
            編集
          </span>
        </button>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-xs" style={{ color: 'var(--state-caution)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
