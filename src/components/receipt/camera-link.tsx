'use client';

import { useRef, useState } from 'react';
import { MdLink } from 'react-icons/md';

import { CAMERA_PATH } from '@/features/receipt-captures/camera-entry';

/** 撮影中のページや認証情報を含めず、カメラへの固定の入口だけをコピーする。 */
export function CameraLink() {
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'manual'>('idle');
  const [url, setUrl] = useState('');

  const copy = async () => {
    if (busyRef.current) return;
    const cameraUrl = new URL(CAMERA_PATH, window.location.origin).href;
    setUrl(cameraUrl);
    busyRef.current = true;
    setStatus('copying');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(cameraUrl);
      setStatus('copied');
    } catch {
      setStatus('manual');
    } finally {
      busyRef.current = false;
    }
  };

  return (
    <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <button
        type="button"
        onClick={() => void copy()}
        disabled={status === 'copying'}
        className="min-h-11 flex w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-50"
        style={{ background: 'rgba(255,255,255,0.12)' }}
      >
        <MdLink aria-hidden size={20} />
        {status === 'copying' ? 'コピー中…' : 'カメラURLをコピー'}
      </button>
      <p role="status" className="text-center text-xs">
        {status === 'copied'
          ? 'コピーしました。このURLを開くとカメラが起動します。'
          : status === 'manual'
            ? 'コピーできませんでした。下のURLを選択してコピーしてください。'
            : ''}
      </p>
      {status === 'manual' ? (
        <div className="mt-2 flex gap-2">
          <input
            ref={inputRef}
            type="text"
            inputMode="url"
            aria-label="カメラを開くURL"
            readOnly
            value={url}
            className="min-h-11 min-w-0 flex-1 rounded-lg border px-3 text-sm"
            style={{ background: '#111', borderColor: 'rgba(255,255,255,0.4)', color: '#fff' }}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className="min-h-11 rounded-lg px-3 text-sm"
            style={{ background: 'rgba(255,255,255,0.18)' }}
            onClick={() => {
              const field = inputRef.current;
              field?.focus();
              field?.select();
              field?.setSelectionRange(0, field.value.length);
            }}
          >
            URLを選択
          </button>
        </div>
      ) : null}
    </div>
  );
}
