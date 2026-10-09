'use client';

import { useState } from 'react';

import { generateMonthlyAiReportAction } from './ai/actions';

/** 固定の気づきとは別に、今の記録をAIに分析させて出す。 */
export function AiInsightButton() {
  const [lines, setLines] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    const result = await generateMonthlyAiReportAction();
    setBusy(false);
    if (result.error || result.report === null) {
      setError(result.error ?? '分析できませんでした。');
      return;
    }
    setLines(result.report.insights);
  };

  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="min-h-12 w-full rounded-full text-base font-semibold disabled:opacity-40"
        style={{ background: 'var(--action)', color: 'var(--on-action)' }}
      >
        {busy ? '分析しています…' : 'AIに分析させる'}
      </button>
      {error ? (
        <p className="text-sm" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
      {lines && lines.length > 0 ? (
        <div className="glass space-y-2 rounded-2xl p-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            AIの気づき
          </h2>
          <ul className="space-y-2">
            {lines.map((line) => (
              <li key={line} className="text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
