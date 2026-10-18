'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useIsClient } from '@/components/ui/use-is-client';
import { Yen } from '@/components/ui/money';

type Props = {
  selectMode: boolean;
  count: number;
  availableCount: number;
  ready: boolean;
  splitDisabledReason: string | null;
  expenseTotalYen?: number | undefined;
  hidden?: boolean;
  onStart: () => void;
  onExit: () => void;
  onSplit: () => void;
  onCopy: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  /** 「店名を整える」(AI で店名の表記ゆれを探す、ADR-119)。選択中は出さない。 */
  onTidy?: (() => void) | undefined;
};

/** ページのアニメーションから離し、一覧のどこでも右上から選択した明細を操作する。 */
export function LedgerSelectionMenu({
  selectMode,
  count,
  availableCount,
  ready,
  splitDisabledReason,
  expenseTotalYen,
  hidden = false,
  onStart,
  onExit,
  onSplit,
  onCopy,
  onSelectAll,
  onClear,
  onTidy,
}: Props) {
  const isClient = useIsClient();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  function act(action: () => void) {
    setOpen(false);
    trigger.current?.focus();
    action();
  }

  if (!isClient || hidden) return null;
  const unavailable = count === 0 || !ready;
  const itemClass =
    'flex w-full items-center rounded-xl px-3 py-3 text-left text-[15px] font-medium hover:bg-[var(--accent-track)] disabled:opacity-40';

  return createPortal(
    <div
      data-no-pull
      role="region"
      aria-label="明細の選択"
      className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-40 mx-auto flex max-w-2xl justify-end px-4"
    >
      {onTidy && !selectMode ? (
        <button
          type="button"
          onClick={onTidy}
          className="pointer-events-auto mr-2 flex min-h-11 items-center gap-1 rounded-full border px-4 text-[15px] font-semibold"
          style={{
            background: 'var(--surface-raised)',
            borderColor: 'var(--hairline)',
            boxShadow: 'var(--card-shadow)',
            color: 'var(--accent)',
          }}
        >
          <span aria-hidden>✦</span>
          店名を整える
        </button>
      ) : null}
      <div ref={root} className="pointer-events-auto relative max-w-full">
        <div
          className="flex items-center rounded-full border px-1"
          style={{
            background: 'var(--surface-raised)',
            borderColor: 'var(--hairline)',
            boxShadow: 'var(--card-shadow)',
            color: 'var(--accent)',
          }}
        >
          {selectMode ? (
            <>
              <button
                ref={trigger}
                type="button"
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-controls={open ? 'ledger-selection-actions' : undefined}
                onClick={() => setOpen((value) => !value)}
                className="tabular flex min-h-11 items-center gap-2 px-3 text-[14px] font-semibold"
              >
                <span aria-live="polite">{count}件を選択</span>
                <span aria-hidden>⌄</span>
              </button>
              <button
                type="button"
                onClick={() => act(onExit)}
                className="min-h-11 px-3 text-[14px] font-semibold"
              >
                完了
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={!ready || availableCount === 0}
              onClick={onStart}
              className="min-h-11 px-4 text-[15px] font-semibold disabled:opacity-40"
            >
              選択
            </button>
          )}
        </div>
        {selectMode && open ? (
          <div
            ref={panel}
            id="ledger-selection-actions"
            role="dialog"
            aria-label="選択した明細の操作"
            tabIndex={-1}
            className="absolute top-full right-0 mt-2 max-h-[calc(100dvh-env(safe-area-inset-top)-6rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-2xl border p-2 shadow-lg"
            style={{
              background: 'var(--surface-raised)',
              borderColor: 'var(--hairline)',
              color: 'var(--ink)',
            }}
          >
            <p className="px-3 py-2 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              選択した明細 {count}件
            </p>
            {expenseTotalYen !== undefined ? (
              <p className="tabular px-3 pb-2 text-[16px] font-semibold">
                支出合計 <Yen value={expenseTotalYen} />
              </p>
            ) : null}
            <button
              type="button"
              disabled={unavailable}
              onClick={() => !unavailable && act(onCopy)}
              className={`min-h-11 ${itemClass}`}
            >
              内容をコピー
            </button>
            <button
              type="button"
              disabled={unavailable || splitDisabledReason !== null}
              aria-describedby={splitDisabledReason ? 'ledger-selection-split-reason' : undefined}
              onClick={() => !unavailable && splitDisabledReason === null && act(onSplit)}
              className={`min-h-11 ${itemClass}`}
            >
              割り勘
            </button>
            {splitDisabledReason ? (
              <p
                id="ledger-selection-split-reason"
                className="px-3 pb-2 text-[12px]"
                style={{ color: 'var(--ink-muted)' }}
              >
                {splitDisabledReason}
              </p>
            ) : null}
            <div className="my-1 border-t" style={{ borderColor: 'var(--hairline)' }} />
            <button
              type="button"
              disabled={!ready || availableCount === 0 || count === availableCount}
              onClick={() => ready && availableCount > count && act(onSelectAll)}
              className={`min-h-11 ${itemClass}`}
            >
              すべて選択
            </button>
            <button
              type="button"
              disabled={count === 0}
              onClick={() => count > 0 && act(onClear)}
              className={`min-h-11 ${itemClass}`}
            >
              選択を解除
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
