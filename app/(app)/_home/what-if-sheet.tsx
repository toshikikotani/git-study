'use client';

import { useEffect, useState } from 'react';

import { BottomSheet, BottomSheetHeader } from '@/components/ui/bottom-sheet';
import { whatIfRows, whatIfVerdict, type WhatIfSpend } from '@/domain/forecast/what-if-spend';
import { cachedRecordGenres, prefetchRecordData, useOpenRecord } from '../record-sheet';
import { simulateSpendAction } from './what-if-actions';

/** 試す額のチップ(デザイン v3-2)。 */
const PRESETS = [1000, 3000, 5000, 8000] as const;

type Genre = { id: string; name: string };

/**
 * 「もし使ったら？」のボタン(今日の目安のカードの左下、デザイン v3-1)。押すと試算のシート。
 */
export function WhatIfButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center justify-center gap-1 rounded-full text-[15px] font-bold"
        style={{ background: 'var(--action)', color: 'var(--on-action)' }}
      >
        <svg
          aria-hidden
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        もし使ったら？
      </button>
      <WhatIfSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * もし使ったら(デザイン v3-2、ADR-108)。今日あといくら使ったら、着地見込み・目標内の確率・明日からの目安・
 * 月末の貯金がどう変わるかを、ホームと同じ予測で出し比べる。閉じるだけなら何も記録しない。
 * 「予定に入れる」で、その額を入れた「記録する」を開く。AIの「金額を変えて試す」からも開く。
 */
export function WhatIfSheet({
  open,
  onClose,
  initialAmountYen,
}: {
  open: boolean;
  onClose: () => void;
  /** 最初に選ぶ額(チップに無ければ足す)。 */
  initialAmountYen?: number | undefined;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} role="dialog" label="もし使ったら" tall>
      {open ? <WhatIfBody onClose={onClose} initialAmountYen={initialAmountYen} /> : null}
    </BottomSheet>
  );
}

function WhatIfBody({
  onClose,
  initialAmountYen,
}: {
  onClose: () => void;
  initialAmountYen: number | undefined;
}) {
  const openRecord = useOpenRecord();
  const amounts = [...new Set([...(initialAmountYen ? [initialAmountYen] : []), ...PRESETS])].sort(
    (a, b) => a - b,
  );
  const [picked, setPicked] = useState(initialAmountYen ?? 3000);
  const [genres, setGenres] = useState<readonly Genre[]>(() => cachedRecordGenres() ?? []);
  const [genreId, setGenreId] = useState<string | null>(null);
  const [result, setResult] = useState<WhatIfSpend | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void prefetchRecordData().then(() => {
      const cached = cachedRecordGenres();
      if (cached) setGenres(cached);
    });
  }, []);

  // 額をまとめて1回で計算する(チップを押し替えるたびに待たせない)。カテゴリを変えたら計算し直す。
  const key = amounts.join(',');
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 計算し直すあいだの表示
    setLoading(true);
    setError(null);
    void simulateSpendAction(key.split(',').map(Number), genreId)
      .then((r) => {
        if (!alive) return;
        setResult(r.result);
        setError(r.error);
      })
      .catch(() => {
        if (alive)
          setError('見通しを計算できませんでした。電波のよい所で、もう一度開いてください。');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [key, genreId]);

  const option = result?.options.find((o) => o.amountYen === picked) ?? null;
  const base = result?.base ?? null;

  const rows = base && option ? whatIfRows(base, option) : [];

  return (
    <div className="flex flex-col gap-3 pb-4" style={{ color: 'var(--ink)' }}>
      <BottomSheetHeader className="grid grid-cols-[1fr_auto_1fr] items-center pt-1">
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-11 items-center justify-self-start text-[17px]"
          style={{ color: 'var(--accent)' }}
        >
          閉じる
        </button>
        <span className="text-[17px] font-semibold">もし使ったら</span>
        <span />
      </BottomSheetHeader>

      <section
        className="flex flex-col items-center gap-3 rounded-[20px] px-4 pt-3 pb-4"
        style={{ background: 'var(--surface)' }}
      >
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-[15px]" style={{ color: 'var(--ink-muted)' }}>
            今日あと
          </span>
          <label
            className="flex min-h-11 items-center rounded-full px-3 text-[14px] font-semibold"
            style={{ background: 'var(--plane)' }}
          >
            <span className="sr-only">カテゴリ</span>
            <select
              value={genreId ?? ''}
              onChange={(e) => setGenreId(e.target.value === '' ? null : e.target.value)}
              className="max-w-40 bg-transparent text-right outline-none"
              style={{ color: 'var(--ink)' }}
            >
              <option value="">カテゴリなし</option>
              {genres.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="tabular flex items-baseline gap-1">
          <span className="text-[48px] leading-none font-bold">
            {picked.toLocaleString('ja-JP')}
          </span>
          <span className="text-[22px] font-semibold">円</span>
        </p>
        <div
          role="group"
          aria-label="試す額"
          className="grid w-full gap-2"
          style={{ gridTemplateColumns: `repeat(${amounts.length}, minmax(0, 1fr))` }}
        >
          {amounts.map((a) => {
            const on = a === picked;
            return (
              <button
                key={a}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked(a)}
                className="tabular min-h-11 rounded-full text-[15px] font-semibold"
                style={
                  on
                    ? { background: 'var(--action)', color: 'var(--on-action)' }
                    : { background: 'var(--plane)', color: 'var(--ink)' }
                }
              >
                {a.toLocaleString('ja-JP')}
              </button>
            );
          })}
        </div>
      </section>

      <section
        aria-live="polite"
        aria-busy={loading}
        className="flex flex-col rounded-[20px] px-4 py-2"
        style={{ background: 'var(--surface)' }}
      >
        {error ? (
          <p role="alert" className="py-3 text-[14px]" style={{ color: 'var(--over)' }}>
            {error}
          </p>
        ) : loading && rows.length === 0 ? (
          <p className="py-3 text-[14px]" style={{ color: 'var(--ink-muted)' }}>
            見通しを計算しています…
          </p>
        ) : rows.length === 0 ? (
          <p className="py-3 text-[14px]" style={{ color: 'var(--ink-muted)' }}>
            今期の目標を決めると、見通しの変わり方を出せます。
          </p>
        ) : (
          rows.map((r, i) => (
            <div
              key={r.label}
              className="tabular grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-2 py-3 text-[15px]"
              style={{
                borderTop: i > 0 ? '1px solid var(--hairline)' : undefined,
                opacity: loading ? 0.5 : 1,
              }}
            >
              <span style={{ color: 'var(--ink-secondary)' }}>{r.label}</span>
              <span style={{ color: 'var(--ink-muted)' }}>{r.before}</span>
              <span aria-hidden style={{ color: 'var(--ink-muted)' }}>
                →
              </span>
              <strong className="text-[17px]">{r.after}</strong>
            </div>
          ))
        )}
      </section>

      {result && option && !loading ? (
        <p className="px-1 text-[15px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {whatIfVerdict(result, option)}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => {
          onClose();
          openRecord?.({ amountYen: picked, genreId });
        }}
        className="min-h-12 rounded-full text-[16px] font-bold"
        style={{ background: 'var(--action)', color: 'var(--on-action)' }}
      >
        予定に入れる
      </button>
      <span className="text-center text-[12px]" style={{ color: 'var(--ink-muted)' }}>
        閉じるだけなら何も記録されません
      </span>
    </div>
  );
}
