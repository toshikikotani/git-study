'use client';

/** AI月次レポートのカード(ADR-031)。押されたときだけ AI を呼ぶ。 */

import { useState } from 'react';

import { AiLabel } from '@/components/ui/ai-label';
import { BulletList } from '@/components/ui/bullet-list';
import { ProgressGauge } from '@/components/ui/meter';
import { WasteRatioBars } from '@/components/ui/waste-ratio-bars';
import { formatYen } from '@/domain/money';
import { SPENDING_PERSONA_DESCRIPTIONS, SPENDING_PERSONA_LABELS } from '@/domain/persona';
import type { AiTrust } from '@/domain/ai-forecast-read';
import type { ForecastReadView } from '@/features/ai-report/forecast-read';
import type { MonthlyReportForecast } from '@/features/ai-report/monthly-report-ai';
import type { MonthlyAiReportView } from '@/features/ai-report/store';
import { formatDateJa } from '@/lib/date';
import { generateMonthlyAiReportAction } from './actions';

export function MonthlyReportCard({ view }: { view: MonthlyAiReportView }) {
  const [report, setReport] = useState(view.report);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const { input } = view;
  const wasteRatioPoints = input.wasteRatioTrend.map((row) => ({
    monthKey: row.monthKey,
    ratio: row.wasteRatio,
  }));

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
          今月の家計データから、支出傾向のタイプ・気づき・アドバイスをAIがまとめます。
        </p>
      ) : (
        <>
          <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              支出傾向のタイプ
            </p>
            <p className="mt-1 text-base font-semibold" style={{ color: 'var(--accent)' }}>
              {SPENDING_PERSONA_LABELS[report.personaType]}
            </p>
            <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {SPENDING_PERSONA_DESCRIPTIONS[report.personaType]}
            </p>
            <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {report.personaReasoning}
            </p>
          </div>

          <ForecastReadSection
            forecast={input.forecast}
            read={report.forecastRead}
            trust={input.evidence.trust}
          />

          <BulletList heading="気づき" items={report.insights} />
          <BulletList heading="アドバイス" items={report.advice} />
          <AiLabel feature="monthly-report" contentKey={input.monthKey} evidenceHref="/spending" />
        </>
      )}

      <WasteRatioBars points={wasteRatioPoints} />

      {input.savings.nextGoal !== null && input.savings.nextGoal.progressRatio !== null ? (
        <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              {input.savings.nextGoal.title}
            </p>
            {input.savings.nextGoal.remainingYen !== null ? (
              <p className="tabular text-xs font-medium" style={{ color: 'var(--ink)' }}>
                あと {formatYen(input.savings.nextGoal.remainingYen, { sign: 'never' })}
              </p>
            ) : null}
          </div>
          <div className="mt-2">
            <ProgressGauge
              ratio={input.savings.nextGoal.progressRatio}
              label={`貯金 ${Math.round(input.savings.nextGoal.progressRatio * 100)}%`}
            />
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void run()}
        disabled={pending}
        className="mt-4 w-full rounded-full py-3 text-sm font-semibold disabled:opacity-40"
        style={{ background: 'var(--action)', color: 'var(--on-action)' }}
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

const round100 = (yen: number) => Math.round(yen / 100) * 100;
const yen = (n: number) => formatYen(round100(n), { sign: 'never' });

/**
 * 着地の見込み:統計(確率予測 v2)と、AIの読み(ADR-072)を並べる。AIの読みは、統計が見ていない
 * 事情(メモ・品目・予定・暦)から残りの支出を動かしたもので、これまでの当たり具合に応じて効かせる。
 */
function ForecastReadSection({
  forecast,
  read,
  trust,
}: {
  forecast: MonthlyReportForecast | null;
  read: ForecastReadView | null;
  trust: AiTrust;
}) {
  if (forecast === null && read === null) return null;
  const stat = read?.stat ?? forecast!;
  const signed = (p: number) => `${p > 0 ? '+' : ''}${p}%`;
  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        着地の見込み{read ? `(${formatDateJa(read.asOf)}時点)` : ''}
      </p>
      <dl className="mt-2 space-y-2 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt style={{ color: 'var(--ink-secondary)' }}>統計</dt>
          <dd className="tabular text-right" style={{ color: 'var(--ink)' }}>
            中央 {yen(stat.p50)}
            <span className="block text-xs" style={{ color: 'var(--ink-muted)' }}>
              少なくて {yen(stat.p10)} 〜 多くて {yen(stat.p90)}
            </span>
          </dd>
        </div>
        {read ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt style={{ color: 'var(--ink-secondary)' }}>AIの読み</dt>
            <dd className="tabular text-right font-semibold" style={{ color: 'var(--accent)' }}>
              中央 {yen(read.adjusted.p50)}
              <span className="block text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
                残りの支出 {signed(read.percent)}
                {read.percent !== 0
                  ? `(当たり具合から ${signed(read.adjusted.effectivePercent)} だけ効かせる)`
                  : ''}
              </span>
            </dd>
          </div>
        ) : null}
      </dl>
      {read ? (
        <>
          <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {read.reason}
          </p>
          {read.evidence.length > 0 ? (
            <ul className="mt-1 space-y-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {read.evidence.map((e, i) => (
                <li key={i}>・{e}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
          レポートを更新すると、AIの読み(統計が見ていない事情からの補正)が出ます。
        </p>
      )}
      <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        {trust.compared === 0
          ? 'AIの読みの当たり具合はまだ分からないので、補正は半分だけ効かせる。'
          : `これまでAIの読みが統計より近かったのは ${trust.compared}回中${trust.wins}回。補正はその割合に応じて効かせる。`}
      </p>
    </div>
  );
}
