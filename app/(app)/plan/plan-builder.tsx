'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatYen } from '@/domain/money';
import {
  DEFAULT_PLAN_PRESET,
  PLAN_PRESET_LABELS,
  PLAN_PRESET_ORDER,
  planPreset,
  type PlanPresetId,
} from '@/domain/plan-presets';
import type { PlanEvidence } from '@/domain/plan-evidence';
import { PLAN_STEP_OPTIONS, planPeriodDays } from '@/domain/spending-plan';
import { findOverlap, overlapMessage, reservationStart } from '@/domain/plan-periods';
import { formatDateJa, type DateOnly } from '@/lib/date';
import { savePlanAction, suggestPlanAction } from './actions';
import { AllocationEditor } from './allocation-editor';
import { RangeCalendar } from './range-calendar';

const STEP_LABELS: Record<(typeof PLAN_STEP_OPTIONS)[number], string> = {
  5: 'ゆるく',
  10: 'ふつう',
  20: 'しっかり',
};

type EditableItem = {
  genreId: string;
  genreName: string;
  baselineYen: number;
  aiSuggestedYen: number;
  reason: string;
};

type Suggestion = {
  items: EditableItem[];
  summary: string;
  warnings: string[];
  usedAi: boolean;
  uncategorizedYen: number;
  evidence: PlanEvidence;
  /** 記録がないジャンル(予算0円として並べず、折りたたむ)。 */
  noRecord: string[];
};

/**
 * 期間を選び、AIに目標案を作ってもらい、本人が直して保存する(本人発案、ADR-058)。
 * 「徐々に改善」のため、改善の強さ(1回で削る幅の上限)を選べる。
 */
export function PlanBuilder({
  today,
  payday,
  ranges,
  activeEnd,
}: {
  today: DateOnly;
  payday: number;
  /** すでにある目標の期間。重なる期間は作れない。 */
  ranges: readonly { id: string; periodStart: DateOnly; periodEnd: DateOnly }[];
  /** 進行中の目標の終了日。あれば「次の目標を予約」として折りたたみ、開始日を翌日にする。 */
  activeEnd: DateOnly | null;
}) {
  const router = useRouter();
  const reserving = activeEnd !== null;
  // 予約のときは、進行中の目標の終了日の翌日から。
  const baseDate = reserving ? reservationStart(activeEnd) : today;
  // 初期選択は「1週間」。短い期間から始めて、結果を見て次の目標へ進める。
  const initial = planPreset(DEFAULT_PLAN_PRESET, baseDate, payday);
  const [preset, setPreset] = useState<PlanPresetId | null>(DEFAULT_PLAN_PRESET);
  const [start, setStart] = useState<DateOnly | null>(initial.start);
  const [end, setEnd] = useState<DateOnly | null>(initial.end);
  const [step, setStep] = useState<(typeof PLAN_STEP_OPTIONS)[number]>(10);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState<'suggest' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsGenres, setNeedsGenres] = useState(false);

  const conflict = start !== null && end !== null ? findOverlap(ranges, { start, end }) : null;
  const overlapError = conflict === null ? null : overlapMessage(conflict);

  const setRange = (range: { start: DateOnly | null; end: DateOnly | null }) => {
    setPreset(null);
    setStart(range.start);
    setEnd(range.end);
    setSuggestion(null);
  };

  const suggest = async () => {
    if (start === null || end === null || overlapError !== null) return;
    setBusy('suggest');
    setError(null);
    setNeedsGenres(false);
    const result = await suggestPlanAction(start, end, step);
    setBusy(null);
    if (result.error !== null) {
      setError(result.error);
      setNeedsGenres(result.needsGenres === true);
      return;
    }
    setSuggestion({
      // 記録がないジャンルは、予算0円として並べず「予算なし」に折りたたむ。
      items: result.items
        .filter((item) => item.baselineYen > 0)
        .map((item) => ({
          genreId: item.genreId,
          genreName: item.genreName,
          baselineYen: item.baselineYen,
          aiSuggestedYen: item.suggestedYen,
          reason: `${item.reason}(1日あたりの中央値 ${formatYen(result.medianByGenre[item.genreId] ?? 0, { sign: 'never' })})`,
        })),
      noRecord: result.items.filter((item) => item.baselineYen <= 0).map((item) => item.genreName),
      evidence: result.evidence,
      summary: result.summary,
      warnings: result.warnings,
      usedAi: result.usedAi,
      uncategorizedYen: result.uncategorizedYen,
    });
  };

  const save = async (
    items: { genreId: string; targetYen: number }[],
  ): Promise<{ error: string | null }> => {
    if (start === null || end === null || suggestion === null) return { error: null };
    if (overlapError !== null) return { error: overlapError };
    const byId = new Map(suggestion.items.map((item) => [item.genreId, item]));
    const result = await savePlanAction({
      periodStart: start,
      periodEnd: end,
      stepPercent: step,
      items: items.map((item) => ({
        genreId: item.genreId,
        targetYen: item.targetYen,
        aiSuggestedYen: byId.get(item.genreId)?.aiSuggestedYen ?? null,
        reason: byId.get(item.genreId)?.reason ?? null,
      })),
    });
    if (result.error === null) {
      setSuggestion(null);
      router.refresh();
    }
    return result;
  };

  return (
    <details
      open={!reserving}
      className="glass rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <summary
        className="min-h-11 cursor-pointer list-none text-sm font-semibold"
        style={{ color: 'var(--ink)' }}
      >
        {reserving ? '次の目標を予約' : '新しい目標を立てる'}
        {reserving ? (
          <span className="ml-2 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
            進行中の目標の次の期間から →
          </span>
        ) : null}
      </summary>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        カレンダーで期間を選ぶと、AIが過去の支出と課題から、ジャンルごとの目標を提案します。
        提案は目安なので、あとから自由に直せます。
      </p>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="期間のプリセット">
        {PLAN_PRESET_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={preset === id}
            onClick={() => {
              const range = planPreset(id, baseDate, payday);
              setRange({ start: range.start, end: range.end });
              setPreset(id);
            }}
            className="min-h-11 rounded-full px-3 py-1 text-xs font-semibold"
            style={{
              background: preset === id ? 'var(--accent)' : 'var(--accent-track)',
              color: preset === id ? 'var(--on-accent)' : 'var(--accent)',
            }}
          >
            {PLAN_PRESET_LABELS[id]}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <RangeCalendar
          start={start}
          end={end}
          today={baseDate}
          blocked={ranges.map((r) => ({ from: r.periodStart, to: r.periodEnd }))}
          onChange={setRange}
        />
      </div>

      {overlapError !== null ? (
        <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--ink)' }}>
          <span aria-hidden>▲ </span>
          {overlapError}
        </p>
      ) : null}

      <p className="mt-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
        {start === null
          ? '開始日をタップしてください'
          : end === null
            ? `${formatDateJa(start)} から。終了日をタップしてください`
            : `${formatDateJa(start)} 〜 ${formatDateJa(end)}(${planPeriodDays(start, end)}日間)`}
      </p>

      <div className="mt-3">
        <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
          改善の強さ(課題のあるジャンルを、今回どこまで削るか)
        </p>
        <div className="mt-2 flex gap-2">
          {PLAN_STEP_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={step === option}
              onClick={() => {
                setStep(option);
                setSuggestion(null);
              }}
              className="min-h-11 flex-1 rounded-full py-2 text-xs font-semibold"
              style={{
                background: step === option ? 'var(--accent)' : 'var(--accent-track)',
                color: step === option ? 'var(--on-accent)' : 'var(--accent)',
              }}
            >
              {STEP_LABELS[option]}({option}%)
            </button>
          ))}
        </div>
      </div>

      <Button
        variant="filled"
        className="mt-4 w-full"
        disabled={start === null || end === null || busy !== null || overlapError !== null}
        onClick={() => void suggest()}
      >
        {busy === 'suggest' ? '目標案を作っています…' : 'AIに目標案を作ってもらう'}
      </Button>

      {suggestion !== null ? (
        <div className="mt-4 space-y-3 border-t pt-4" style={{ borderColor: 'var(--hairline)' }}>
          {/* 根拠(記録日数・対象期間・中央値)。記録が14日未満なら「暫定」 */}
          <div
            className="rounded-xl p-3 text-xs leading-relaxed"
            style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
          >
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                提案の根拠
              </span>
              {suggestion.evidence.provisional ? (
                <span
                  className="rounded-full px-2 py-1 text-xs font-semibold"
                  style={{ background: 'var(--attention-track)', color: 'var(--state-caution)' }}
                >
                  暫定
                </span>
              ) : null}
            </p>
            <p className="tabular mt-1">
              家計簿の記録 {suggestion.evidence.recordedDays}日分
              {suggestion.evidence.from
                ? `(${formatDateJa(suggestion.evidence.from)} 〜 ${formatDateJa(suggestion.evidence.to)})`
                : ''}
              ・ 1日あたりの支出の中央値{' '}
              {formatYen(suggestion.evidence.medianDailyYen, { sign: 'never' })}
            </p>
            {suggestion.evidence.provisional ? (
              <p className="mt-1" style={{ color: 'var(--ink-muted)' }}>
                記録が14日に満たないため、暫定の目安です。記録がそろったら作り直せます。
              </p>
            ) : null}
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {suggestion.summary}
          </p>
          {suggestion.warnings.map((w) => (
            <p key={w} className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              {w}
            </p>
          ))}
          {suggestion.uncategorizedYen > 0 ? (
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              未分類の支出が{formatYen(suggestion.uncategorizedYen, { sign: 'never' })}
              あり、目標に含まれていません。先に
              <Link
                href="/reports/genres"
                className="min-h-11 inline-flex items-center font-semibold"
                style={{ color: 'var(--accent)' }}
              >
                ジャンル分類
              </Link>
              すると、より正確な案になります。
            </p>
          ) : null}

          {suggestion.noRecord.length > 0 ? (
            <details className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              <summary className="min-h-11 cursor-pointer font-semibold">
                予算なし({suggestion.noRecord.length}件・記録がないジャンル)
              </summary>
              <p className="mt-1 leading-relaxed">{suggestion.noRecord.join('、')}</p>
            </details>
          ) : null}

          <AllocationEditor
            key={`${start}-${end}-${step}-${suggestion.summary}`}
            periodStart={start!}
            periodEnd={end!}
            rows={suggestion.items.map((item) => ({
              genreId: item.genreId,
              genreName: item.genreName,
              baselineYen: item.baselineYen,
              note: item.reason,
              yen: item.aiSuggestedYen,
            }))}
            saveLabel="この目標で保存する"
            onSave={save}
          />
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 text-xs" style={{ color: 'var(--over)' }}>
          {error}
          {needsGenres ? (
            <Link
              href="/reports/genres"
              className="min-h-11 ml-1 inline-flex items-center font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              ジャンル分類へ
            </Link>
          ) : null}
        </p>
      ) : null}
    </details>
  );
}
