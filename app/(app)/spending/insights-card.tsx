'use client';

/**
 * 気づき(AI家計診断とちりつもを小さくまとめたカード)。
 *
 * AI家計診断(ADR-030)は押されたときだけ AI を呼ぶ。「浪費」は「見直し候補」と
 * 表記し、見直し候補 + 必要経費 + 未診断額 = 使った額の合計 になるよう、未診断額も
 * 明示する(domain/diagnosis.ts の diagnosisBreakdown。合計は家計簿の集計と同じ値)。
 * 見直し候補・必要経費どちらも理由付きで全件出す(上位N件に絞らない)。
 *
 * ── 内訳は開くまで畳んでおく(本人からのUX指摘「パンパンパンパン、
 *    詳細見たかったら詳細見るみたいな感じがいい」)──────────────────
 * 以前は診断済みなら内訳・6ヶ月推移まで常に全展開で、この画面で
 * 一番縦に場所を取っていた。見出しと浪費比率だけを常に見せ、内訳
 * (理由付きリスト・推移グラフ)は「詳しく見る」を押すまで畳む。
 */

import { useState } from 'react';

import Link from 'next/link';

import { diagnosisBreakdown, wasteRatioOf } from '@/domain/diagnosis';
import { formatYen } from '@/domain/money';
import type { DiagnosedItem, SpendingDiagnosisView } from '@/features/diagnosis/store';
import { WasteRatioBars } from '@/components/ui/waste-ratio-bars';
import { formatDateJa } from '@/lib/date';
import { diagnoseSpendingAction } from './actions';

export function InsightsCard({
  view,
  totalSpentYen,
  pile,
}: {
  view: SpendingDiagnosisView;
  /** 今月使った額(集計関数の値)。診断の内訳の合計にそろえる。 */
  totalSpentYen: number;
  pile: { thresholdYen: number; smallSpendTotalYen: number };
}) {
  const [current, setCurrent] = useState(view.currentMonth);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const { summary, wasteItems, necessaryItems, undiagnosedCount } = current;
  const breakdown = diagnosisBreakdown({
    totalSpentYen,
    wasteYen: summary.wasteYen,
    necessaryYen: summary.necessaryYen,
  });
  const wasteRatioPoints = view.trend.rows.map((row) => ({
    monthKey: row.monthKey,
    ratio: wasteRatioOf(row),
  }));

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
    // props の更新(revalidatePath)を待たずに残り件数だけ先に動かす。
    setCurrent((prev) => ({
      ...prev,
      undiagnosedCount: Math.max(prev.undiagnosedCount - result.diagnosedCount, 0),
    }));
  };

  return (
    <div
      aria-label="気づき"
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
          気づき ・ AI家計診断
        </p>
        {summary.wasteRatio !== null ? (
          <p className="tabular text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            見直し候補 {Math.round(summary.wasteRatio * 100)}%
          </p>
        ) : null}
      </div>

      {summary.wasteRatio === null ? (
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          投資家目線で、今の支出が見直し候補か必要経費かをAIが判断します。
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="mt-2 flex w-full items-center justify-between gap-3 text-left"
          >
            <span className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              見直し候補 {formatYen(breakdown.reviewYen, { sign: 'never' })} ・ 必要経費{' '}
              {formatYen(breakdown.necessaryYen, { sign: 'never' })} ・ 未診断{' '}
              {formatYen(breakdown.undiagnosedYen, { sign: 'never' })} = 合計{' '}
              {formatYen(breakdown.totalYen, { sign: 'never' })}
            </span>
            <span className="shrink-0 text-xs font-semibold" style={{ color: 'var(--accent)' }}>
              {detailsOpen ? '閉じる' : '詳しく見る'}
            </span>
          </button>

          {detailsOpen ? (
            <>
              <DiagnosisItemList
                heading="見直し候補と判断した内訳"
                items={wasteItems}
                amountColor="var(--ink)"
              />
              <DiagnosisItemList
                heading="必要経費と判断した内訳"
                items={necessaryItems}
                amountColor="var(--ink)"
              />

              <WasteRatioBars points={wasteRatioPoints} />
            </>
          ) : null}
        </>
      )}

      {undiagnosedCount > 0 ? (
        <button
          type="button"
          onClick={() => void run()}
          disabled={pending}
          className="mt-4 w-full rounded-full py-2.5 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
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
        <p role="alert" className="mt-2 text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}

      {/* ちりつも(小口支出の積み重ね)は補助。要約1行だけ見せて詳細へ */}
      <Link
        href="/spending/pile"
        className="mt-3 flex items-center justify-between gap-3 border-t pt-3"
        style={{ borderColor: 'var(--hairline)' }}
      >
        <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
          ちりつも:1回{formatYen(pile.thresholdYen, { sign: 'never' })}未満の小口支出、今月は{' '}
          <span className="tabular">{formatYen(pile.smallSpendTotalYen, { sign: 'never' })}</span>
        </p>
        <span className="shrink-0 text-xs font-semibold" style={{ color: 'var(--accent)' }}>
          詳しく →
        </span>
      </Link>
    </div>
  );
}

/** 判断理由を添えた内訳。浪費側・必要経費側で同じ形にする。 */
function DiagnosisItemList({
  heading,
  items,
  amountColor,
}: {
  heading: string;
  items: readonly DiagnosedItem[];
  amountColor: string;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
      <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {heading}
      </p>
      <ul className="mt-2 space-y-2.5">
        {items.map((item) => (
          <li key={item.id}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-xs" style={{ color: 'var(--ink)' }}>
                {item.label}
              </span>
              <span className="tabular shrink-0 text-xs font-medium" style={{ color: amountColor }}>
                {formatYen(item.amountYen)}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              {formatDateJa(item.occurredOn)} ・ {item.reasoning}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
