'use client';

import { useState } from 'react';

import { updateMonthlySavingsTargetAction } from './actions';

/**
 * * 貯金目標の毎月の額(ADR-108 → 127)。今日の画面の貯金カードとAIの窓口が見る値を、ここで決める・直す
 * (1か所で管理)。
 */
export function MonthlyTarget({ initialYen }: { initialYen: number }) {
  const [value, setValue] = useState(initialYen > 0 ? initialYen.toLocaleString('ja-JP') : '');
  const [saved, setSaved] = useState(initialYen);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const amountYen = Number(value.replace(/[^\d]/g, '')) || 0;

  const save = async () => {
    setPending(true);
    setError(null);
    const result = await updateMonthlySavingsTargetAction(amountYen);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSaved(amountYen);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* 保存は見出しの右(右上、ADR-131)。入力欄の横に置くと、狭い画面で右端からはみ出していた。 */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[15px] font-semibold">毎月</p>
        <button
          type="button"
          onClick={() => void save()}
          disabled={pending || amountYen === saved}
          className="-mr-2 min-h-11 min-w-11 shrink-0 px-2 text-[17px] font-semibold disabled:opacity-40"
          style={{ color: 'var(--accent)' }}
        >
          {pending ? '保存中…' : '保存'}
        </button>
      </div>
      <p className="text-[13px] leading-normal" style={{ color: 'var(--ink-muted)' }}>
        今日の「貯金」とAIは、この額で月末の見込みと比べます。0円にすると決めていない扱いです。
      </p>
      <label
        className="flex min-h-11 min-w-0 items-center gap-1 rounded-xl px-3"
        style={{ background: 'var(--plane)' }}
      >
        <span className="sr-only">毎月の貯金目標(円)</span>
        <input
          inputMode="numeric"
          value={value}
          placeholder="例:100,000"
          autoComplete="off"
          onChange={(e) => {
            const digits = e.target.value.replace(/[^\d]/g, '');
            setValue(digits === '' ? '' : Number(digits).toLocaleString('ja-JP'));
          }}
          className="tabular w-0 min-w-0 flex-1 bg-transparent text-right text-[17px] outline-none"
          style={{ color: 'var(--ink)' }}
        />
        <span className="text-[15px]">円</span>
      </label>
      {error ? (
        <p role="alert" className="text-[13px]" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
