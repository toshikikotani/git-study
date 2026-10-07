'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Card } from '@/components/ui/card';
import { formatYen, parseYen } from '@/domain/money';
import { starterTargetYen } from '@/domain/onboarding';
import { PLAN_PRESET_LABELS, planPreset, type PlanPresetId } from '@/domain/plan-presets';
import { planPeriodDays } from '@/domain/spending-plan';
import { formatDateJa, type DateOnly } from '@/lib/date';
import { completeWelcomeAction, skipWelcomeAction } from './actions';

type Starter = { genreId: string; name: string; share: number };

/** はじめての設定で選べる期間(短い期間から始めて、結果を見て次の目標へ)。 */
const PRESETS: readonly PlanPresetId[] = ['one_week', 'until_payday', 'month_end'];

const INPUT_STYLE = {
  background: 'var(--plane)',
  color: 'var(--ink)',
  border: '1px solid var(--hairline)',
} as const;

function toYen(text: string): number | null {
  try {
    const value = parseYen(text);
    return Number.isInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * はじめての設定の3つの段(ADR-084)。保存は最後に1回だけ(途中でやめても何も残らない)。
 */
export function WelcomeFlow({
  today,
  initialTakeHomeYen,
  initialPayday,
  starters,
}: {
  today: DateOnly;
  initialTakeHomeYen: number;
  initialPayday: number;
  starters: readonly Starter[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [takeHomeText, setTakeHomeText] = useState(String(initialTakeHomeYen));
  const [payday, setPayday] = useState(initialPayday);
  const [preset, setPreset] = useState<PlanPresetId>('one_week');
  // 本人が直した額だけを持つ(直していないジャンルは、手取りと期間から目安を出し直す)。
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [goalTitle, setGoalTitle] = useState('');
  const [goalAmountText, setGoalAmountText] = useState('');
  const [goalDate, setGoalDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const takeHomeYen = toYen(takeHomeText);
  const period = planPreset(preset, today, payday);
  const days = planPeriodDays(period.start, period.end);
  const rows = starters.map((s) => {
    const suggested = starterTargetYen(takeHomeYen ?? 0, s.share, days);
    const text = edited[s.genreId] ?? String(suggested);
    return { ...s, suggested, text, yen: toYen(text), on: off[s.genreId] !== true };
  });
  const chosen = rows.filter((r) => r.on);
  const totalYen = chosen.reduce((sum, r) => sum + (r.yen ?? 0), 0);

  function next() {
    setError(null);
    if (step === 1) {
      if (takeHomeYen === null || takeHomeYen <= 0) {
        setError('手取りを1円以上で入れてください');
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (chosen.length === 0) {
        setError('目標にするジャンルを1つ以上選んでください');
        return;
      }
      if (chosen.some((r) => r.yen === null)) {
        setError('目標の額は0円以上の数字で入れてください');
        return;
      }
      setStep(3);
    }
  }

  function finish(withGoal: boolean) {
    setError(null);
    const goalAmount = goalAmountText.trim() === '' ? null : toYen(goalAmountText);
    if (withGoal && goalTitle.trim() === '') {
      setError('何のために貯めるかを入れてください(あとでも作れます)');
      return;
    }
    if (withGoal && goalAmountText.trim() !== '' && (goalAmount === null || goalAmount <= 0)) {
      setError('貯めたい額は1円以上の数字で入れてください');
      return;
    }
    startTransition(async () => {
      const result = await completeWelcomeAction({
        takeHomeYen: takeHomeYen ?? 0,
        payday,
        periodStart: period.start,
        periodEnd: period.end,
        items: chosen.map((r) => ({ genreId: r.genreId, targetYen: r.yen ?? 0 })),
        savingsGoal: withGoal
          ? {
              title: goalTitle.trim(),
              targetAmountYen: goalAmount,
              targetDate: goalDate === '' ? null : goalDate,
            }
          : null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push('/');
      router.refresh();
    });
  }

  return (
    <div className="rise space-y-4">
      <header>
        <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
          はじめての設定 {step}/3
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          {step === 1 ? 'まずは手取りと給料日' : step === 2 ? '今日からの目標' : '貯金目標(任意)'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {step === 1
            ? '使える額と、給料日までの期間を出すのに使います。あとから設定で変えられます。'
            : step === 2
              ? '今日から、よく使うジャンルにいくらまで使うかを決めます。額は手取りからの目安です。自由に直してください。'
              : '何のために、いくら貯めたいかを決めると、毎月いくら残せばいいかが見えます。'}
        </p>
      </header>

      <Card>
        {step === 1 ? (
          <div className="space-y-4">
            <Field label="毎月の手取り(円)">
              <input
                type="text"
                inputMode="numeric"
                value={takeHomeText}
                onChange={(e) => setTakeHomeText(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm"
                style={INPUT_STYLE}
                aria-label="毎月の手取り(円)"
              />
            </Field>
            <Field label="給料日">
              <select
                value={payday}
                onChange={(e) => setPayday(Number(e.target.value))}
                className="w-full rounded-xl px-3 py-2 text-sm"
                style={INPUT_STYLE}
                aria-label="給料日"
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d === 31 ? '月末' : `${d}日`}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : step === 2 ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="期間">
              {PRESETS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={preset === id}
                  onClick={() => setPreset(id)}
                  className="rounded-full px-3 py-2 text-xs font-semibold"
                  style={
                    preset === id
                      ? { background: 'var(--action)', color: 'var(--on-action)' }
                      : { background: 'var(--plane)', color: 'var(--ink-secondary)' }
                  }
                >
                  {PLAN_PRESET_LABELS[id]}
                </button>
              ))}
            </div>
            <p className="tabular text-xs" style={{ color: 'var(--ink-muted)' }}>
              {formatDateJa(period.start)} 〜 {formatDateJa(period.end)}({days}日間)
            </p>

            {rows.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
                ジャンルを読み込めませんでした。目標の画面から立ててください。
              </p>
            ) : (
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li key={r.genreId} className="flex items-center gap-3">
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={r.on}
                        onChange={(e) => setOff((v) => ({ ...v, [r.genreId]: !e.target.checked }))}
                      />
                      <span style={{ color: r.on ? 'var(--ink)' : 'var(--ink-muted)' }}>
                        {r.name}
                      </span>
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={r.text}
                      disabled={!r.on}
                      onChange={(e) => setEdited((v) => ({ ...v, [r.genreId]: e.target.value }))}
                      className="tabular w-28 rounded-xl px-3 py-2 text-right text-sm disabled:opacity-40"
                      style={INPUT_STYLE}
                      aria-label={`${r.name}の目標(円)`}
                    />
                  </li>
                ))}
              </ul>
            )}
            <p
              className="tabular border-t pt-3 text-right text-sm font-semibold"
              style={{ borderColor: 'var(--hairline)', color: 'var(--ink)' }}
            >
              合計 {formatYen(totalYen, { sign: 'never' })}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="何のために">
              <input
                type="text"
                value={goalTitle}
                onChange={(e) => setGoalTitle(e.target.value)}
                placeholder="旅行・引っ越し・もしものとき など"
                className="w-full rounded-xl px-3 py-2 text-sm"
                style={INPUT_STYLE}
              />
            </Field>
            <Field label="いくら(円・任意)">
              <input
                type="text"
                inputMode="numeric"
                value={goalAmountText}
                onChange={(e) => setGoalAmountText(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm"
                style={INPUT_STYLE}
              />
            </Field>
            <Field label="いつまでに(任意)">
              <input
                type="date"
                value={goalDate}
                min={today}
                onChange={(e) => setGoalDate(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm"
                style={INPUT_STYLE}
              />
            </Field>
          </div>
        )}
      </Card>

      {error ? (
        <p role="alert" className="text-sm" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep(step === 3 ? 2 : 1);
            }}
            disabled={pending}
            className="rounded-full px-4 py-3 text-sm font-medium disabled:opacity-40"
            style={{ color: 'var(--ink-muted)' }}
          >
            もどる
          </button>
        ) : null}
        {step < 3 ? (
          <button
            type="button"
            onClick={next}
            className="flex-1 rounded-full py-3 text-sm font-semibold"
            style={{ background: 'var(--action)', color: 'var(--on-action)' }}
          >
            つぎへ
          </button>
        ) : (
          <button
            type="button"
            onClick={() => finish(true)}
            disabled={pending}
            className="flex-1 rounded-full py-3 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--action)', color: 'var(--on-action)' }}
          >
            {pending ? '保存中…' : 'この内容ではじめる'}
          </button>
        )}
      </div>

      {step === 3 ? (
        <button
          type="button"
          onClick={() => finish(false)}
          disabled={pending}
          className="w-full text-center text-xs font-medium disabled:opacity-40"
          style={{ color: 'var(--accent)' }}
        >
          貯金目標はあとで決めて、はじめる
        </button>
      ) : null}

      <form action={skipWelcomeAction} className="pt-2 text-center">
        <button type="submit" className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          設定はあとでする
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
