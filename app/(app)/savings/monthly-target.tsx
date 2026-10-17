'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { updateMonthlySavingsTargetAction } from './actions';

/**
 * 毎月の貯金目標(ADR-108)。ホームの貯金カードとAIの窓口が見る値を、ここで決める・直す(1か所で管理)。
 */
export function MonthlyTarget({ initialYen }: { initialYen: number }) {
  const router = useRouter();
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
    router.refresh();
  };

  return (
    <section
      aria-labelledby="monthly-target"
      className="flex flex-col gap-2 rounded-[22px] px-4 py-4"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <h2 id="monthly-target" className="text-[17px] font-semibold">
        毎月の貯金目標
      </h2>
      <p className="text-[13px] leading-normal" style={{ color: 'var(--ink-muted)' }}>
        ホームの「貯金」とAIは、この額で月末の見込みと比べます。0円にすると決めていない扱いです。
      </p>
      <div className="flex items-center gap-2">
        <label
          className="flex min-h-11 flex-1 items-center gap-1 rounded-xl px-3"
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
            className="tabular min-w-0 flex-1 bg-transparent text-right text-[17px] outline-none"
            style={{ color: 'var(--ink)' }}
          />
          <span className="text-[15px]">円</span>
        </label>
        <button
          type="button"
          onClick={() => void save()}
          disabled={pending || amountYen === saved}
          className="min-h-11 shrink-0 rounded-full px-5 text-[15px] font-semibold disabled:opacity-40"
          style={{ background: 'var(--action)', color: 'var(--on-action)' }}
        >
          {pending ? '保存中…' : '保存'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-[13px]" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
