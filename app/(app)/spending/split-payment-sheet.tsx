'use client';

import { useRef, useState } from 'react';

import { BottomSheet, BottomSheetHeader } from '@/components/ui/bottom-sheet';
import { buildSplitPaymentRequest, type SplitPaymentEntry } from '@/domain/split-payment-request';

type Props = {
  transactions: readonly SplitPaymentEntry[];
  onClose: () => void;
};

export function SplitPaymentSheet({ open, onClose, transactions }: Props & { open: boolean }) {
  return (
    <BottomSheet open={open} onClose={onClose} label="割り勘" tall>
      <SplitPaymentForm transactions={transactions} onClose={onClose} />
    </BottomSheet>
  );
}

const yen = (amount: number) => `${amount.toLocaleString('ja-JP')}円`;

/** コピーする文面をその場で確認する。保存済みの明細には変更を加えない。 */
export function SplitPaymentForm({ transactions, onClose }: Props) {
  const [people, setPeople] = useState('2');
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<{ text: string; message: string } | null>(null);
  const [copying, setCopying] = useState(false);
  const previewRef = useRef<HTMLTextAreaElement>(null);

  let request: ReturnType<typeof buildSplitPaymentRequest> | null = null;
  let error: string | null = null;
  try {
    request = buildSplitPaymentRequest(transactions, Number(people));
  } catch (cause) {
    error = cause instanceof Error ? cause.message : '人数と明細を確認してください。';
  }

  async function copy() {
    if (!request || copying) return;
    const text = request.message;
    setCopying(true);
    setCopyError(null);
    setCopiedText(null);
    try {
      if (!navigator.clipboard?.writeText) {
        setCopyError({
          text,
          message: 'このブラウザではコピーできません。文面を選択してコピーしてください。',
        });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
    } catch {
      setCopyError({
        text,
        message: 'コピーできませんでした。文面を選択してコピーしてください。',
      });
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="pb-4" style={{ color: 'var(--ink)' }}>
      <BottomSheetHeader className="mb-5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 justify-self-start px-2 text-sm font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          戻る
        </button>
        <h2 className="text-base font-semibold">割り勘</h2>
        <button
          type="button"
          onClick={copy}
          disabled={!request || copying}
          className="min-h-11 justify-self-end px-2 text-sm font-semibold disabled:opacity-40"
          style={{ color: 'var(--accent)' }}
        >
          {copying ? 'コピー中…' : 'コピー'}
        </button>
      </BottomSheetHeader>

      <div className="space-y-5">
        <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
          明細に記録されている金額で計算します。
        </p>

        <div>
          <label htmlFor="split-payment-participants" className="mb-2 block text-sm font-semibold">
            人数（自分を含む）
          </label>
          <input
            id="split-payment-participants"
            type="number"
            inputMode="numeric"
            min={2}
            step={1}
            required
            value={people}
            onChange={(event) => {
              setPeople(event.target.value);
              setCopiedText(null);
              setCopyError(null);
            }}
            aria-invalid={error !== null}
            aria-describedby={error ? 'split-payment-error' : undefined}
            className="tabular min-h-12 w-full rounded-2xl border px-4 text-lg"
            style={{
              background: 'var(--surface)',
              borderColor: 'var(--hairline)',
              color: 'var(--ink)',
            }}
          />
          {error ? (
            <p id="split-payment-error" role="alert" className="mt-2 text-sm">
              {error}
            </p>
          ) : null}
        </div>

        {request ? (
          <>
            <div className="rounded-2xl p-4" style={{ background: 'var(--surface)' }}>
              <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
                相手1人あたり
              </p>
              <p className="tabular mt-1 text-3xl font-semibold">
                {yen(request.amountPerPersonYen)}
              </p>
              <p className="mt-3 text-sm" style={{ color: 'var(--ink-secondary)' }}>
                合計 {yen(request.totalYen)} · {request.participants}人
              </p>
              <p className="mt-1 text-sm" style={{ color: 'var(--ink-secondary)' }}>
                自分の負担 {yen(request.requesterShareYen)}
                {request.remainderYen > 0 ? `（端数${yen(request.remainderYen)}を含む）` : ''}
              </p>
            </div>

            <div>
              <label htmlFor="split-payment-message" className="mb-2 block text-sm font-semibold">
                送る文面
              </label>
              <textarea
                id="split-payment-message"
                ref={previewRef}
                readOnly
                value={request.message}
                rows={Math.min(16, Math.max(8, request.message.split('\n').length))}
                className="w-full resize-y rounded-2xl border p-4 text-sm leading-relaxed"
                style={{
                  background: 'var(--surface)',
                  borderColor: 'var(--hairline)',
                  color: 'var(--ink)',
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const preview = previewRef.current;
                  if (!preview) return;
                  preview.focus();
                  preview.select();
                  preview.setSelectionRange(0, preview.value.length);
                }}
                className="min-h-11 px-2 text-sm font-semibold"
                style={{ color: 'var(--accent)' }}
              >
                文面を選択
              </button>
              <p className="mt-1 text-sm" style={{ color: 'var(--ink-secondary)' }}>
                コピーした文面を、相手へのメッセージに貼り付けて送ってください。
              </p>
            </div>

            {copiedText === request.message ? (
              <p role="status" className="text-sm font-semibold">
                コピーしました
              </p>
            ) : null}
            {copyError?.text === request.message ? (
              <p role="alert" className="text-sm">
                {copyError.message}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
