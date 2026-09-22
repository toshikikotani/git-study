'use client';

/** AI日次レポートのカード(ADR-032)。押されたときだけ AI を呼ぶ。 */

import { useState } from 'react';

import { BulletList } from '@/components/ui/bullet-list';
import { formatYen } from '@/domain/money';
import type { DailyAiReportView } from '@/features/ai-report/store';
import { generateDailyAiReportAction } from './actions';

export function DailyReportCard({ view }: { view: DailyAiReportView }) {
  const [report, setReport] = useState(view.report);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const { input } = view;

  const run = async () => {
    setPending(true);
    setError(null);
    const result = await generateDailyAiReportAction();
    setPending(false);
    setWarnings(result.warnings);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.report) setReport(result.report);
  };

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
          今日の支出
        </p>
        <p className="tabular text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          {formatYen(input.totalSpentYen, { sign: 'never' })}
        </p>
      </div>
      <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        今月のここまでの1日あたり平均 {formatYen(input.averageDailySpendYen, { sign: 'never' })}
      </p>

      {report === null ? (
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          今日の支出を今月の平均と比べて、AIが気づきとアドバイスをまとめます。
        </p>
      ) : (
        <>
          <BulletList heading="気づき" items={report.insights} />
          <BulletList heading="アドバイス" items={report.advice} />
        </>
      )}

      <button
        type="button"
        onClick={() => void run()}
        disabled={pending}
        className="mt-4 w-full rounded-full py-2.5 text-sm font-semibold disabled:opacity-40"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        {pending
          ? '作成しています…'
          : report === null
            ? '今日のレポートを作る'
            : '今日のレポートを更新する'}
      </button>

      {warnings.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
