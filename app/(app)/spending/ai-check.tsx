'use client';

import { useRef, useState } from 'react';

import { BottomSheet, BottomSheetHeader } from '@/components/ui/bottom-sheet';
import type { MerchantNameReviewGroup } from '@/domain/merchant-name-review';
import type { ReceiptCheckGroup } from '@/domain/receipt-check';
import { MerchantNameResults } from './merchant-name-review';
import { ReceiptCheckResults } from './receipt-check';

/** 探した結果(api の返事)。groups が null のあいだは探している途中。 */
type Scan<T> = { groups: readonly T[] | null; error: string | null; warning: string | null };
type ScanResponse<T> = { groups: T[]; warning: string | null } | { error: string };

const SCANNING = { groups: null, error: null, warning: null } as const;

/** 読むだけの確認を api に頼む。通信に失敗しても、その欄に理由を出すだけにする。 */
async function scan<T>(url: string, signal: AbortSignal): Promise<Scan<T>> {
  try {
    const response = await fetch(url, { method: 'POST', signal });
    const body = (await response.json()) as ScanResponse<T>;
    return 'error' in body
      ? { groups: [], error: body.error, warning: null }
      : { groups: body.groups, error: null, warning: body.warning };
  } catch {
    return { groups: [], error: '通信に失敗しました。もう一度お試しください。', warning: null };
  }
}

/**
 * 明細の右上「AIでチェック」(本人の要望、ADR-119 → 120)。start() でシートを開き、すべての月の
 * 店名の表記ゆれ(api/merchant-names/scan)と、最近のレシートの品目の読み取りミス(api/receipts/check)
 * を同時に探す。片方が遅くても、先に終わったほうから出す。開くたびに探し直し、閉じたら探すのをやめる。
 */
export function useAiCheck(onClosed?: () => void): {
  start: () => void;
  sheet: React.ReactNode;
} {
  const [run, setRun] = useState<{
    id: number;
    names: Scan<MerchantNameReviewGroup>;
    receipts: Scan<ReceiptCheckGroup>;
  } | null>(null);
  const aborter = useRef<AbortController | null>(null);
  const start = () => {
    aborter.current?.abort();
    const controller = new AbortController();
    aborter.current = controller;
    const id = Date.now();
    setRun({ id, names: SCANNING, receipts: SCANNING });
    const settle = (
      patch: Partial<{ names: Scan<MerchantNameReviewGroup>; receipts: Scan<ReceiptCheckGroup> }>,
    ) => {
      if (controller.signal.aborted) return;
      setRun((current) => (current?.id !== id ? current : { ...current, ...patch }));
    };
    void scan<MerchantNameReviewGroup>('/api/merchant-names/scan', controller.signal).then(
      (names) => settle({ names }),
    );
    void scan<ReceiptCheckGroup>('/api/receipts/check', controller.signal).then((receipts) =>
      settle({ receipts }),
    );
  };
  const close = () => {
    aborter.current?.abort();
    setRun(null);
    onClosed?.();
  };
  const sheet = (
    <AiCheckSheet
      key={run?.id ?? 0}
      open={run !== null}
      names={run?.names ?? SCANNING}
      receipts={run?.receipts ?? SCANNING}
      onClose={close}
    />
  );
  return { start, sheet };
}

export function AiCheckSheet({
  open,
  names,
  receipts,
  onClose,
}: {
  open: boolean;
  names: Scan<MerchantNameReviewGroup>;
  receipts: Scan<ReceiptCheckGroup>;
  onClose: () => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} label="AIでチェック">
      <BottomSheetHeader className="flex items-center justify-between gap-3">
        <h2 className="text-[18px] font-semibold" style={{ color: 'var(--ink)' }}>
          AIでチェック
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 px-2 text-sm font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          閉じる
        </button>
      </BottomSheetHeader>
      <section aria-labelledby="ai-check-names" className="mt-2">
        <h3
          id="ai-check-names"
          className="text-[15px] font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          店名
        </h3>
        <MerchantNameResults groups={names.groups} error={names.error} warning={names.warning} />
      </section>
      <section
        aria-labelledby="ai-check-receipts"
        className="border-t pt-3"
        style={{ borderColor: 'var(--hairline)' }}
      >
        <h3
          id="ai-check-receipts"
          className="text-[15px] font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          レシートの品目
        </h3>
        <ReceiptCheckResults
          groups={receipts.groups}
          error={receipts.error}
          warning={receipts.warning}
        />
      </section>
    </BottomSheet>
  );
}
