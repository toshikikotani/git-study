'use client';

import { useOptimistic, useState, useTransition } from 'react';

import { Segmented } from '@/components/ui/segmented';
import {
  CHECK_LEVELS,
  CHECK_LEVEL_LABEL,
  CHECK_LEVEL_SUB,
  type CheckLevel,
} from '@/domain/receipt-questions';
import { updateReceiptCheckLevelAction } from './receipt-actions';

/**
 * レシートの確かめる細かさ(v5 変更5、ADR-133)。読み取りの自信に応じて、確認の画面で何を聞くかを変える。
 * 押したらそのまま保存し、保存できなかったら元に戻して知らせる。
 */
export function ReceiptCheckSetting({ level }: { level: CheckLevel }) {
  const [value, setValue] = useOptimistic(level);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (next: CheckLevel) =>
    startTransition(async () => {
      setValue(next);
      try {
        const result = await updateReceiptCheckLevelAction(next);
        setError(result.error);
      } catch {
        setError('保存できませんでした。通信を確かめて、もう一度押してください。');
      }
    });

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <span className="flex min-w-0 flex-col">
        <span className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
          確かめる細かさ
        </span>
        <span
          role={error ? 'alert' : undefined}
          className="text-[12px]"
          style={{ color: error ? 'var(--over)' : 'var(--ink-muted)' }}
        >
          {pending ? '保存しています…' : (error ?? CHECK_LEVEL_SUB[value])}
        </span>
      </span>
      <Segmented
        label="レシートの確かめる細かさ"
        value={value}
        options={CHECK_LEVELS.map((l) => ({ value: l, label: CHECK_LEVEL_LABEL[l] }))}
        onChange={save}
        className="self-start"
      />
    </div>
  );
}
