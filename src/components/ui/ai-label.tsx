'use client';

/**
 * AI出力の透明性表示(N1本人要件「AIが作った文章には小さな『AI』ラベルを付け、
 * 根拠の取引へのリンクと、👍👎のフィードバックボタンを付ける」)。
 * AIが書いた文章(レポート・気づき・回答)の直下に置く共通部品。
 */

import { useState } from 'react';
import { MdThumbDown, MdThumbUp } from 'react-icons/md';

import { saveAiFeedback, type AiFeedbackValue } from '@/lib/ai-feedback';
import type { Route } from 'next';
import Link from 'next/link';

export function AiLabel({
  feature,
  contentKey,
  evidenceHref,
}: {
  /** どのAI機能の出力か(フィードバックの内訳に使う)。例: 'daily-report' */
  feature: string;
  /** 同じ出力への重複フィードバックを避けるための識別子。 */
  contentKey: string;
  /** 根拠のデータ(取引一覧・明細)へのリンク。無ければ省略。 */
  evidenceHref?: Route | string;
}) {
  const [picked, setPicked] = useState<AiFeedbackValue | null>(null);

  function feedback(value: AiFeedbackValue): void {
    if (picked !== null) return;
    setPicked(value);
    saveAiFeedback({ feature, contentKey, value, at: new Date().toISOString() });
  }

  return (
    <div className="mt-2 flex items-center gap-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
      <span
        className="rounded-full px-2 py-1 font-semibold"
        style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
      >
        AI
      </span>
      {evidenceHref !== undefined ? (
        <Link
          href={evidenceHref as Route}
          className="min-h-11 inline-flex items-center underline underline-offset-2"
        >
          根拠を見る
        </Link>
      ) : null}
      <span className="ml-auto flex items-center gap-2">
        {picked === null ? (
          <>
            <button
              type="button"
              aria-label="役に立った"
              onClick={() => feedback('up')}
              className="min-h-11 min-w-11 flex items-center justify-center"
            >
              <MdThumbUp aria-hidden size={14} />
            </button>
            <button
              type="button"
              aria-label="役に立たなかった"
              onClick={() => feedback('down')}
              className="min-h-11 min-w-11 flex items-center justify-center"
            >
              <MdThumbDown aria-hidden size={14} />
            </button>
          </>
        ) : (
          <span>フィードバックありがとうございます</span>
        )}
      </span>
    </div>
  );
}
