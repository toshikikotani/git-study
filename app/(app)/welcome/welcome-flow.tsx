'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Card } from '@/components/ui/card';
import { formatYen, parseYen } from '@/domain/money';
import { starterTargetYen } from '@/domain/onboarding';
import { optionalSavingsGoal } from '@/features/onboarding/optional-savings';
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
 * 手取り・目標・確認の3段。貯金は確認画面で任意に追加し、最後にまとめて保存する。
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
        setError('目標にするカテゴリを1つ以上選んでください');
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
    const savings = withGoal
      ? optionalSavingsGoal({ title: goalTitle, amountText: goalAmountText, targetDate: goalDate })
      : { goal: null, error: null };
    if (savings.error) {
      setError(savings.error);
      return;
    }
    startTransition(async () => {
      const result = await completeWelcomeAction({
        takeHomeYen: takeHomeYen ?? 0,
        payday,
        periodStart: period.start,
        periodEnd: period.end,
        items: chosen.map((r) => ({ genreId: r.genreId, targetYen: r.yen ?? 0 })),
        savingsGoal: savings.goal,
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
          {step === 1
            ? 'まずは手取りと給料日'
            : step === 2
              ? '今日からの目標'
              : 'この内容ではじめる'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {step === 1
            ? '使える額と、給料日までの期間を出すのに使います。あとから設定で変えられます。'
            : step === 2
              ? '今日から、よく使うカテゴリにいくらまで使うかを決めます。額は手取りからの目安です。自由に直してください。'
              : '内容を確認して、そのままはじめられます。貯金目標は希望するときだけ追加できます。'}
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
                カテゴリを読み込めませんでした。目標の画面から立ててください。
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
            <dl className="space-y-2 text-sm" style={{ color: 'var(--ink)' }}>
              <div className="flex justify-between gap-3">
                <dt>毎月の手取り</dt>
                <dd>{formatYen(takeHomeYen ?? 0, { sign: 'never' })}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>給料日</dt>
                <dd>{payday === 31 ? '月末' : `${payday}日`}</dd>
              </div>
              <div>
                <dt>今日からの目標</dt>
                <dd className="mt-1" style={{ color: 'var(--ink-muted)' }}>
                  {formatDateJa(period.start)} 〜 {formatDateJa(period.end)}
                </dd>
              </div>
              {chosen.map((r) => (
                <div key={r.genreId} className="flex justify-between gap-3">
                  <dt>{r.name}</dt>
                  <dd>{formatYen(r.yen ?? 0, { sign: 'never' })}</dd>
                </div>
              ))}
              <div
                className="flex justify-between gap-3 border-t pt-2 font-semibold"
                style={{ borderColor: 'var(--hairline)' }}
              >
                <dt>目標の合計</dt>
                <dd>{formatYen(totalYen, { sign: 'never' })}</dd>
              </div>
            </dl>
            <details>
              <summary
                className="min-h-11 cursor-pointer py-3 text-sm font-semibold"
                style={{ color: 'var(--accent)' }}
              >
                貯金目標を追加する（任意）
              </summary>
              <p className="mb-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
                空欄のままでも、下の「この内容ではじめる」で完了できます。
              </p>
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
            </details>
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

      {step === 3 &&
      (goalTitle.trim() !== '' || goalAmountText.trim() !== '' || goalDate !== '') ? (
        <button
          type="button"
          onClick={() => finish(false)}
          disabled={pending}
          className="w-full text-center text-xs font-medium disabled:opacity-40"
          style={{ color: 'var(--accent)' }}
        >
          貯金目標を保存せず、この内容ではじめる
        </button>
      ) : null}

      <form action={skipWelcomeAction} className="pt-2 text-center">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 text-xs disabled:opacity-40"
          style={{ color: 'var(--ink-muted)' }}
        >
          入力を保存せず、あとで設定する
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
