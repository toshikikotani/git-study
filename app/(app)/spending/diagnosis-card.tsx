'use client';

/**
 * AI家計診断(本人発案:「AIの分析が弱い。もっと客観視した分析が必要。
 * 投資家目線で今のが浪費か必要経費なのか判断する機構とそれを分析結果を
 * 蓄積表示改善する機能が必要」、ADR-030)。
 *
 * 押されたときだけ AI を呼ぶ(diagnosis-ai.ts 参照)。今月の内訳・浪費の
 * 上位・直近6ヶ月の浪費比率の推移をこのカード1枚にまとめる。
 */

import { useState } from 'react';

import { wasteRatioOf } from '@/domain/diagnosis';
import { formatYen } from '@/domain/money';
import type { SpendingDiagnosisView } from '@/features/diagnosis/store';
import { formatDateJa } from '@/lib/date';
import { diagnoseSpendingAction } from './actions';

export function DiagnosisCard({ view }: { view: SpendingDiagnosisView }) {
  const [current, setCurrent] = useState(view.currentMonth);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const { summary, wasteItems, undiagnosedCount } = current;

  const run = async () => {
    setPending(true);
    setError(null);
    const result = await diagnoseSpendingAction();
    setPending(false);
    setWarnings(result.warnings);
    if (result.error) {
      setError(result.error);
      return;
    }
    // revalidatePath がサーバー側の props を更新するが、ボタンを押した
    // その場でも「あと何件」が動いたことだけは分かるようにしておく
    // (診断件数が減った分を先に引く。実際の内訳・浪費上位はページの
    // 再取得で追いつく)。
    setCurrent((prev) => ({
      ...prev,
      undiagnosedCount: Math.max(prev.undiagnosedCount - result.diagnosedCount, 0),
    }));
  };

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
          AI家計診断
        </p>
        {summary.wasteRatio !== null ? (
          <p className="tabular text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            浪費 {Math.round(summary.wasteRatio * 100)}%
          </p>
        ) : null}
      </div>

      {summary.wasteRatio === null ? (
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          投資家目線で、今の支出が浪費か必要経費かをAIが判断します。
        </p>
      ) : (
        <>
          <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            浪費 {formatYen(summary.wasteYen, { sign: 'never' })} ・ 必要経費{' '}
            {formatYen(summary.necessaryYen, { sign: 'never' })}
          </p>

          {wasteItems.length > 0 ? (
            <ul
              className="mt-3 space-y-2.5 border-t pt-3"
              style={{ borderColor: 'var(--hairline)' }}
            >
              {wasteItems.map((item) => (
                <li key={item.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-xs" style={{ color: 'var(--ink)' }}>
                      {item.label}
                    </span>
                    <span
                      className="tabular shrink-0 text-xs font-medium"
                      style={{ color: 'var(--over)' }}
                    >
                      {formatYen(item.amountYen)}
                    </span>
                  </div>
                  <p
                    className="mt-0.5 text-[11px] leading-relaxed"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    {formatDateJa(item.occurredOn)} ・ {item.reasoning}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}

          <DiagnosisTrendBars trend={view.trend} />
        </>
      )}

      {undiagnosedCount > 0 ? (
        <button
          type="button"
          onClick={() => void run()}
          disabled={pending}
          className="mt-4 w-full rounded-full py-2.5 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {pending ? '診断しています…' : `今月の${undiagnosedCount}件をAIで診断する`}
        </button>
      ) : null}

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

/**
 * 浪費比率の推移(本人発案:「蓄積して...月ごとの浪費傾向の推移」)。
 * app/(app)/reports/category-trend-chart.tsx と同じ棒グラフの組み方
 * (相対位置のコンテナ+絶対位置の塗り、bottom 基準)。診断していない月は
 * バーを出さない(0%と誤読させない、domain/diagnosis.ts の wasteRatioOf 参照)。
 */
function DiagnosisTrendBars({ trend }: { trend: SpendingDiagnosisView['trend'] }) {
  const ratios = trend.rows.map(wasteRatioOf);
  if (ratios.every((r) => r === null)) return null;

  return (
    <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
      <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        浪費比率の推移
      </p>
      <div className="mt-2 flex h-16 items-end gap-[3px]">
        {trend.rows.map((row, i) => {
          const ratio = ratios[i] ?? null;
          return (
            <div
              key={row.monthKey}
              className="relative h-full flex-1 overflow-hidden rounded-t-[3px]"
              style={{ background: 'var(--over-track)' }}
              title={
                ratio === null
                  ? `${monthLabel(row.monthKey)}: 未診断`
                  : `${monthLabel(row.monthKey)}: 浪費 ${Math.round(ratio * 100)}%`
              }
            >
              {ratio !== null ? (
                <div
                  className="absolute inset-x-0 bottom-0 rounded-t-[3px]"
                  style={{ height: `${Math.round(ratio * 100)}%`, background: 'var(--over)' }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[3px]">
        {trend.rows.map((row) => (
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
