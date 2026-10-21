'use client';

import { useOptimistic, useState, useTransition } from 'react';

import { Switch } from '@/components/ui/switch';
import { updateEveningCheckAction } from './evening-actions';

const TIMES = ['18:00', '19:00', '20:00', '21:00', '22:00', '23:00'] as const;

/**
 * LINE の夜の答え合わせ(ADR-130)。自動で入った今日の記録を、この時刻に LINE で確かめる(0件の日は
 * 送らない)。押したらそのまま保存し、保存できなかったら元に戻して知らせる。
 */
export function EveningCheckSetting({
  enabled,
  at,
  lineReady,
}: {
  enabled: boolean;
  at: string;
  /** LINE の連携が設定してあるか(無ければ、送れないことを添える)。 */
  lineReady: boolean;
}) {
  const [value, setValue] = useOptimistic({ enabled, at });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (next: { enabled: boolean; at: string }) =>
    startTransition(async () => {
      setValue(next);
      try {
        const result = await updateEveningCheckAction(next);
        setError(result.error);
      } catch {
        setError('保存できませんでした。通信を確かめて、もう一度押してください。');
      }
    });

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
            夜の答え合わせ(LINE)
          </span>
          <span
            role={error ? 'alert' : undefined}
            className="text-[12px]"
            style={{ color: error ? 'var(--over)' : 'var(--ink-muted)' }}
          >
            {pending
              ? '保存しています…'
              : (error ??
                (lineReady
                  ? '自動で入った今日の記録を、LINE で確かめる(0件の日は送らない)'
                  : 'LINE の連携を設定すると届きます'))}
          </span>
        </span>
        <Switch
          checked={value.enabled}
          onChange={(next) => save({ ...value, enabled: next })}
          label="夜の答え合わせを LINE で受け取る"
        />
      </div>
      {value.enabled ? (
        <label className="flex min-h-11 items-center justify-between gap-3 text-[15px]">
          <span style={{ color: 'var(--ink-secondary)' }}>送る時刻</span>
          <select
            value={TIMES.includes(value.at as (typeof TIMES)[number]) ? value.at : '21:00'}
            onChange={(event) => save({ ...value, at: event.target.value })}
            className="min-h-11 rounded-xl px-3"
            style={{ background: 'var(--plane)', color: 'var(--ink)' }}
          >
            {TIMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
