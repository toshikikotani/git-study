'use client';

import { useState } from 'react';

/** 「音で聞く」(設計書 v3 3.10)。今日あと使える額から読み上げる。 */
export function SpeakButton({ text }: { text: string }) {
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
      <button
        type="button"
        onClick={speak}
        className="min-h-11 shrink-0 rounded-full px-3 text-xs font-semibold whitespace-nowrap"
        style={{ color: 'var(--ink-secondary)' }}
      >
        音で聞く
      </button>
    </span>
  );
}
