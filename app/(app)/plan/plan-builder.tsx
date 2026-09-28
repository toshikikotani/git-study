'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatYen } from '@/domain/money';
import { PLAN_STEP_OPTIONS, planPeriodDays } from '@/domain/spending-plan';
import { addDays, addMonths, formatDateJa, nthDayOfMonth, type DateOnly } from '@/lib/date';
import { savePlanAction, suggestPlanAction } from './actions';
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
  targetInput: string;
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
  const [busy, setBusy] = useState<'suggest' | 'save' | null>(null);
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
          targetInput: String(item.suggestedYen),
        })),
      summary: result.summary,
      warnings: result.warnings,
      usedAi: result.usedAi,
      uncategorizedYen: result.uncategorizedYen,
    });
  };

  const updateTarget = (genreId: string, value: string) => {
    setSuggestion((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            items: prev.items.map((item) =>
              item.genreId === genreId ? { ...item, targetInput: value } : item,
            ),
          },
    );
  };

  const parsed = suggestion?.items.map((item) => {
    const trimmed = item.targetInput.trim();
    const yen = trimmed === '' ? NaN : Number(trimmed);
    return Number.isInteger(yen) && yen >= 0 ? yen : null;
  });
  const allValid = parsed !== undefined && parsed.every((yen) => yen !== null);
  const totalTargetYen = (parsed ?? []).reduce<number>((acc, yen) => acc + (yen ?? 0), 0);
  const totalBaselineYen = (suggestion?.items ?? []).reduce((acc, i) => acc + i.baselineYen, 0);

  const save = async () => {
    if (start === null || end === null || suggestion === null || !allValid) return;
    setBusy('save');
    setError(null);
    const result = await savePlanAction({
      periodStart: start,
      periodEnd: end,
      stepPercent: step,
      items: suggestion.items.map((item, i) => ({
        genreId: item.genreId,
        targetYen: parsed![i]!,
        aiSuggestedYen: item.aiSuggestedYen,
        reason: item.reason,
      })),
    });
    setBusy(null);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    setSuggestion(null);
    router.refresh();
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

          <ul className="space-y-3">
            {suggestion.items.map((item, i) => (
              <li key={item.genreId}>
                <div className="flex items-center justify-between gap-3">
                  <span
                    className="min-w-0 truncate text-sm font-medium"
                    style={{ color: 'var(--ink)' }}
                  >
                    {item.genreName}
                  </span>
                  <label className="flex shrink-0 items-center gap-1 text-sm">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={item.targetInput}
                      onChange={(e) => updateTarget(item.genreId, e.target.value)}
                      aria-label={`${item.genreName}の目標額(円)`}
                      aria-invalid={parsed?.[i] === null}
                      className="tabular w-24 rounded-lg px-2 py-1 text-right"
                      style={{
                        background: 'var(--surface-raised)',
                        color: 'var(--ink)',
                        border: `1px solid ${parsed?.[i] === null ? 'var(--over)' : 'var(--hairline)'}`,
                      }}
                    />
                    <span style={{ color: 'var(--ink-muted)' }}>円</span>
                  </label>
                </div>
                <p
                  className="mt-0.5 text-[11px] leading-relaxed"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  実績ペース {formatYen(item.baselineYen, { sign: 'never' })} ・ {item.reason}
                </p>
              </li>
            ))}
          </ul>

          <div
            className="flex items-baseline justify-between border-t pt-3 text-sm"
            style={{ borderColor: 'var(--hairline)' }}
          >
            <span style={{ color: 'var(--ink-muted)' }}>
              合計(実績ペース {formatYen(totalBaselineYen, { sign: 'never' })})
            </span>
            <span className="tabular font-semibold" style={{ color: 'var(--ink)' }}>
              {formatYen(totalTargetYen, { sign: 'never' })}
            </span>
          </div>

          <Button
            variant="filled"
            className="w-full"
            disabled={!allValid || busy !== null}
            onClick={() => void save()}
          >
            {busy === 'save' ? '保存しています…' : 'この目標で保存する'}
          </Button>
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
