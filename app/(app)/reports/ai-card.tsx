'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { generateMonthlyAiReportAction } from './ai/actions';

/**
 * AIの気づき(デザイン仕様書の「分析 › 目標」、ADR-091):いつ更新した分析か、箇条書き、「もう一度分析する」。
 * 分析し直すと保存して画面を読み直す。今日の画面には、いちばん上の気づきを1行出す(ADR-127)。
 * 「くわしいレポート」で、日次・タイプ診断・アドバイス・見込みの読み・前の月のレポートを開く(ADR-128)。
 */
export function AiCard({
  asOfLabel,
  bullets,
  analyzed,
}: {
  /** 「今日 8:00 更新」「10月14日 更新」。まだ分析していなければ null。 */
  asOfLabel: string | null;
  bullets: readonly string[];
  /** AIの分析がすでにあるか(ボタンの言い方を変える)。 */
  analyzed: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    const result = await generateMonthlyAiReportAction();
    setBusy(false);
    if (result.error || result.report === null) {
      setError(result.error ?? result.warnings[0] ?? '分析できませんでした。');
      return;
    }
    router.refresh();
  };
  return (
    <section
      aria-labelledby="ai-card"
      className="flex flex-col rounded-[22px] px-4 pt-5 pb-4"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="ai-card" className="text-[17px] font-semibold">
          AIの気づき
        </h3>
        {asOfLabel ? (
          <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            {asOfLabel}
          </span>
        ) : null}
      </div>
      {bullets.length > 0 ? (
        <ul
          className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed"
          style={{ color: 'var(--ink-secondary)' }}
        >
          {bullets.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
          まだ分析していません。
        </p>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[13px]" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="min-h-11 rounded-full px-5 text-[15px] font-semibold disabled:opacity-40"
          style={{ background: 'var(--button-quiet)', color: 'var(--ink)' }}
        >
          {busy ? '分析しています…' : analyzed ? 'もう一度分析する' : 'AIに分析させる'}
        </button>
        <Link
          href="/reports/ai?from=/reports"
          className="flex min-h-11 items-center text-[15px] font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          くわしいレポート ›
        </Link>
      </div>
    </section>
  );
}
