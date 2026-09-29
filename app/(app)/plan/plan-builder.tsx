'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatYen } from '@/domain/money';
import { PLAN_STEP_OPTIONS, planPeriodDays } from '@/domain/spending-plan';
import { addDays, addMonths, formatDateJa, nthDayOfMonth, type DateOnly } from '@/lib/date';
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
};

function lastDayOfMonth(date: DateOnly, offsetMonths: number): DateOnly {
  return addDays(addMonths(nthDayOfMonth(date, 1), offsetMonths + 1), -1);
}

/**
 * 期間を選び、AIに目標案を作ってもらい、本人が直して保存する(本人発案、ADR-058)。
 * 「徐々に改善」のため、改善の強さ(1回で削る幅の上限)を選べる。
 */
export function PlanBuilder({ today }: { today: DateOnly }) {
  const router = useRouter();
  const [start, setStart] = useState<DateOnly | null>(today);
  const [end, setEnd] = useState<DateOnly | null>(lastDayOfMonth(today, 0));
  const [step, setStep] = useState<(typeof PLAN_STEP_OPTIONS)[number]>(10);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState<'suggest' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setRange = (range: { start: DateOnly | null; end: DateOnly | null }) => {
    setStart(range.start);
    setEnd(range.end);
    setSuggestion(null);
  };

  const suggest = async () => {
    if (start === null || end === null) return;
    setBusy('suggest');
    setError(null);
    const result = await suggestPlanAction(start, end, step);
    setBusy(null);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    setSuggestion({
      items: result.items
        .filter((item) => item.baselineYen > 0)
        .map((item) => ({
          genreId: item.genreId,
          genreName: item.genreName,
          baselineYen: item.baselineYen,
          aiSuggestedYen: item.suggestedYen,
          reason: item.reason,
        })),
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
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        新しい目標を立てる
      </h2>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        カレンダーで期間を選ぶと、AIが過去の支出と課題から、ジャンルごとの目標を提案します。
        提案は目安なので、あとから自由に直せます。
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {[
          { label: '今月末まで', end: lastDayOfMonth(today, 0) },
          { label: '来月末まで', end: lastDayOfMonth(today, 1) },
        ].map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={() => setRange({ start: today, end: chip.end })}
            className="rounded-full px-3 py-1 text-xs font-semibold"
            style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <RangeCalendar start={start} end={end} today={today} onChange={setRange} />
      </div>

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
        <div className="mt-1.5 flex gap-2">
          {PLAN_STEP_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={step === option}
              onClick={() => {
                setStep(option);
                setSuggestion(null);
              }}
              className="flex-1 rounded-full py-1.5 text-xs font-semibold"
              style={{
                background: step === option ? 'var(--accent)' : 'var(--accent-track)',
                color: step === option ? '#fff' : 'var(--accent)',
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
        disabled={start === null || end === null || busy !== null}
        onClick={() => void suggest()}
      >
        {busy === 'suggest' ? '目標案を作っています…' : 'AIに目標案を作ってもらう'}
      </Button>

      {suggestion !== null ? (
        <div className="mt-4 space-y-3 border-t pt-4" style={{ borderColor: 'var(--hairline)' }}>
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
                className="font-semibold"
                style={{ color: 'var(--accent)' }}
              >
                ジャンル分類
              </Link>
              すると、より正確な案になります。
            </p>
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
        </p>
      ) : null}
    </div>
  );
}
