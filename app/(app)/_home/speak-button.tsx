'use client';

import { useState } from 'react';

/**
 * 「音で聞く」(設計書 v3 3.10)。icon にすると、デザイン仕様書(ADR-090)のグラフの横の丸いボタン
 * (スピーカーの絵だけ。名前は読み上げ用に label)。
 */
export function SpeakButton({
  text,
  label = '音で聞く',
  icon = false,
}: {
  text: string;
  label?: string;
  icon?: boolean;
}) {
  const [note, setNote] = useState<string | null>(null);
  const speak = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setNote('この環境では読み上げできません。');
      return;
    }
    setNote(null);
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    window.speechSynthesis.speak(utterance);
  };
  return (
    <span className="inline-flex items-center gap-2">
      {note ? (
        <span role="status" className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {note}
        </span>
      ) : null}
      {icon ? (
        <button
          type="button"
          onClick={speak}
          aria-label={label}
          className="flex size-11 min-h-11 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
        >
          <svg
            aria-hidden
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 10v4h4l5 4V6L8 10z" />
            <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          onClick={speak}
          className="min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold whitespace-nowrap"
          style={{ color: 'var(--ink)', border: '1px solid var(--hairline)' }}
        >
          {label}
        </button>
      )}
    </span>
  );
}
