'use client';

/**
 * AI月次レポート(本人発案:「AI関連もっと増やしたい。もっと画期的な機能
 * ない?」「日次レポートと月次レポートどっちも出力できるように...性格の
 * 特定もお願いしたい」、ADR-031)。まずは月次レポートから作る(日次は次段階)。
 *
 * 押されたときだけ AI を呼ぶ(monthly-report-ai.ts 参照)。浪費傾向のタイプ・
 * 実データに基づく気づき・行動面のアドバイスをこのカード1枚にまとめる。
 * 医学的な診断やホルモン等の身体的な断定は出さない(本人の明示的な要望)。
 */

import { useState } from 'react';

import { ProgressGauge } from '@/components/ui/meter';
import { formatYen } from '@/domain/money';
import { SPENDING_PERSONA_DESCRIPTIONS, SPENDING_PERSONA_LABELS } from '@/domain/persona';
import type { MonthlyAiReportView } from '@/features/ai-report/store';
import { generateMonthlyAiReportAction } from './actions';

export function MonthlyReportCard({ view }: { view: MonthlyAiReportView }) {
  const [report, setReport] = useState(view.report);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const { input } = view;

  const run = async () => {
    setPending(true);
    setError(null);
    const result = await generateMonthlyAiReportAction();
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
          今月の傾向
        </p>
        <p className="tabular text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          {formatYen(input.totalSpentYen, { sign: 'never' })}
        </p>
      </div>

      {report === null ? (
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          今月の家計データから、浪費傾向のタイプ・気づき・アドバイスをAIがまとめます。
        </p>
      ) : (
        <>
          <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
            <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              浪費傾向のタイプ
            </p>
            <p className="mt-1 text-base font-semibold" style={{ color: 'var(--accent)' }}>
              {SPENDING_PERSONA_LABELS[report.personaType]}
            </p>
            <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {SPENDING_PERSONA_DESCRIPTIONS[report.personaType]}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {report.personaReasoning}
            </p>
          </div>

          <ItemList heading="気づき" items={report.insights} />
          <ItemList heading="アドバイス" items={report.advice} />
        </>
      )}

      <WasteRatioTrendChart trend={input.wasteRatioTrend} />

      <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            負債返済の進捗
          </p>
          <p className="tabular text-xs font-medium" style={{ color: 'var(--ink)' }}>
            {formatYen(input.payoff.remainingYen, { sign: 'never' })} 残
          </p>
        </div>
        <div className="mt-2">
          <ProgressGauge
            ratio={input.payoff.progressRatio}
            label={`返済進捗 ${Math.round(input.payoff.progressRatio * 100)}%`}
          />
        </div>
      </div>

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
            ? '今月のレポートを作る'
            : '今月のレポートを更新する'}
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

function ItemList({ heading, items }: { heading: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
      <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {heading}
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            ・{item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 浪費比率の推移(app/(app)/spending/diagnosis-card.tsx の DiagnosisTrendBars
 * と同じ組み方)。診断していない月はバーを出さない(0%と誤読させない)。
 */
function WasteRatioTrendChart({
  trend,
}: {
  trend: readonly { monthKey: string; wasteRatio: number | null }[];
}) {
  if (trend.every((row) => row.wasteRatio === null)) return null;

  return (
    <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
      <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        浪費比率の推移
      </p>
      <div className="mt-2 flex h-16 items-end gap-[3px]">
        {trend.map((row) => (
          <div
            key={row.monthKey}
            className="relative h-full flex-1 overflow-hidden rounded-t-[3px]"
            style={{ background: 'var(--over-track)' }}
            title={
              row.wasteRatio === null
                ? `${monthLabel(row.monthKey)}: 未診断`
                : `${monthLabel(row.monthKey)}: 浪費 ${Math.round(row.wasteRatio * 100)}%`
            }
          >
            {row.wasteRatio !== null ? (
              <div
                className="absolute inset-x-0 bottom-0 rounded-t-[3px]"
                style={{
                  height: `${Math.round(row.wasteRatio * 100)}%`,
                  background: 'var(--over)',
                }}
              />
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px]">
        {trend.map((row) => (
          <span
            key={row.monthKey}
            className="tabular flex-1 text-center text-[10px]"
            style={{ color: 'var(--ink-muted)' }}
          >
            {monthLabel(row.monthKey)}
          </span>
        ))}
      </div>
    </div>
  );
}

function monthLabel(monthKey: string): string {
  return `${Number(monthKey.slice(5, 7))}月`;
}
