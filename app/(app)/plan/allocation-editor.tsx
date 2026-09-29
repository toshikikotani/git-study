'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatYen } from '@/domain/money';
import { rebalanceToTotal } from '@/domain/spending-plan';
import { refinePlanAction } from './actions';

export type AllocationRow = {
  genreId: string;
  genreName: string;
  /** 過去実績から出した期間の目安額(無ければ null)。 */
  baselineYen: number | null;
  note: string | null;
  yen: number;
};

const STEP_YEN = 1000;

function parseYen(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const yen = Number(trimmed);
  return Number.isInteger(yen) && yen >= 0 ? yen : null;
}

/**
 * ジャンルごとの目標額の配分を直す(本人発案「目標の金額は固定の上、カテゴリごとの
 * 金額を調整したい。AIと相談して微調整、手動でも」、ADR-058)。
 *
 * 総額は固定で、ジャンルの合計がぴったり総額になるまで保存できない。
 * 手で直した額(ピン留め)は動かさず、残りのジャンルで「未配分」を自動で埋められる。
 * AIには、指示に沿った配分の見直しを相談できる(合計は必ず総額にそろえて返る)。
 */
export function AllocationEditor({
  periodStart,
  periodEnd,
  rows,
  saveLabel,
  onSave,
}: {
  periodStart: string;
  periodEnd: string;
  rows: readonly AllocationRow[];
  saveLabel: string;
  onSave: (items: { genreId: string; targetYen: number }[]) => Promise<{ error: string | null }>;
}) {
  const [totalInput, setTotalInput] = useState(String(rows.reduce((acc, r) => acc + r.yen, 0)));
  const [inputs, setInputs] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.genreId, String(r.yen)])),
  );
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const [instruction, setInstruction] = useState('');
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState<'ai' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = rows.map((r) => parseYen(inputs[r.genreId] ?? ''));
  const allValid = parsed.every((yen) => yen !== null);
  const total = parseYen(totalInput);
  const allocated = parsed.reduce<number>((acc, yen) => acc + (yen ?? 0), 0);
  const unallocated = total === null ? null : total - allocated;
  const balanced = allValid && unallocated === 0;

  const setYen = (genreId: string, yen: number, pin: boolean) => {
    setInputs((prev) => ({ ...prev, [genreId]: String(Math.max(yen, 0)) }));
    if (pin) setPinned((prev) => new Set(prev).add(genreId));
    setAiSummary(null);
  };

  /** 手で決めたジャンル(ピン留め)は動かさず、残りのジャンルで総額にそろえる。 */
  const autoBalance = () => {
    if (total === null || !allValid) return;
    const amounts = parsed as number[];
    const weights = rows.map((r, i) => (pinned.has(r.genreId) ? 0 : amounts[i]!));
    const next = rebalanceToTotal(amounts, total, weights);
    setInputs(Object.fromEntries(rows.map((r, i) => [r.genreId, String(next[i])])));
  };

  const consultAi = async () => {
    if (total === null || !allValid) return;
    setBusy('ai');
    setError(null);
    const result = await refinePlanAction({
      periodStart,
      periodEnd,
      totalYen: total,
      items: rows.map((r, i) => ({ genreId: r.genreId, targetYen: parsed[i]! })),
      instruction,
    });
    setBusy(null);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    const byId = new Map(result.items.map((i) => [i.genreId, i.targetYen]));
    setInputs(
      Object.fromEntries(rows.map((r) => [r.genreId, String(byId.get(r.genreId) ?? r.yen)])),
    );
    setPinned(new Set());
    setAiSummary(result.summary);
  };

  const save = async () => {
    if (!balanced) return;
    setBusy('save');
    setError(null);
    const result = await onSave(
      rows.map((r, i) => ({ genreId: r.genreId, targetYen: parsed[i]! })),
    );
    setBusy(null);
    if (result.error !== null) setError(result.error);
  };

  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium" style={{ color: 'var(--ink)' }}>
          総額(固定)
        </span>
        <span className="flex items-center gap-1">
          <input
            type="text"
            inputMode="numeric"
            value={totalInput}
            onChange={(e) => {
              setTotalInput(e.target.value);
              setAiSummary(null);
            }}
            aria-label="目標の総額(円)"
            aria-invalid={total === null}
            className="tabular w-28 rounded-lg px-2 py-1 text-right font-semibold"
            style={{
              background: 'var(--surface-raised)',
              color: 'var(--ink)',
              border: `1px solid ${total === null ? 'var(--over)' : 'var(--hairline)'}`,
            }}
          />
          <span style={{ color: 'var(--ink-muted)' }}>円</span>
        </span>
      </label>

      <p
        className="text-xs"
        role="status"
        style={{ color: balanced ? 'var(--income)' : 'var(--over)' }}
      >
        {unallocated === null
          ? '総額を数字で入力してください'
          : !allValid
            ? '金額を0円以上の整数で入力してください'
            : unallocated === 0
              ? '配分が総額とぴったり合っています'
              : unallocated > 0
                ? `あと${formatYen(unallocated, { sign: 'never' })}が未配分です`
                : `${formatYen(-unallocated, { sign: 'never' })}配りすぎです`}
      </p>

      <ul className="space-y-3">
        {rows.map((row, i) => (
          <li key={row.genreId}>
            <div className="flex items-center justify-between gap-2">
              <span
                className="min-w-0 truncate text-sm font-medium"
                style={{ color: 'var(--ink)' }}
              >
                {row.genreName}
                {pinned.has(row.genreId) ? (
                  <span className="ml-1 text-[10px] font-normal" style={{ color: 'var(--accent)' }}>
                    固定
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`${row.genreName}を${STEP_YEN}円減らす`}
                  onClick={() => setYen(row.genreId, (parsed[i] ?? 0) - STEP_YEN, true)}
                  className="size-8 rounded-full text-base font-semibold"
                  style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
                >
                  −
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  value={inputs[row.genreId] ?? ''}
                  onChange={(e) => {
                    setInputs((prev) => ({ ...prev, [row.genreId]: e.target.value }));
                    setPinned((prev) => new Set(prev).add(row.genreId));
                    setAiSummary(null);
                  }}
                  aria-label={`${row.genreName}の目標額(円)`}
                  aria-invalid={parsed[i] === null}
                  className="tabular w-20 rounded-lg px-2 py-1 text-right text-sm"
                  style={{
                    background: 'var(--surface-raised)',
                    color: 'var(--ink)',
                    border: `1px solid ${parsed[i] === null ? 'var(--over)' : 'var(--hairline)'}`,
                  }}
                />
                <button
                  type="button"
                  aria-label={`${row.genreName}を${STEP_YEN}円増やす`}
                  onClick={() => setYen(row.genreId, (parsed[i] ?? 0) + STEP_YEN, true)}
                  className="size-8 rounded-full text-base font-semibold"
                  style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
                >
                  ＋
                </button>
              </span>
            </div>
            {row.baselineYen !== null || row.note ? (
              <p
                className="mt-0.5 text-[11px] leading-relaxed"
                style={{ color: 'var(--ink-muted)' }}
              >
                {row.baselineYen !== null
                  ? `実績ペース ${formatYen(row.baselineYen, { sign: 'never' })}`
                  : ''}
                {row.baselineYen !== null && row.note ? ' ・ ' : ''}
                {row.note ?? ''}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {!balanced && unallocated !== null && allValid ? (
        <Button variant="tonal" className="w-full" onClick={autoBalance}>
          {pinned.size > 0
            ? '自分で決めた額はそのまま、残りで総額に合わせる'
            : '総額に合うよう自動で配分する'}
        </Button>
      ) : null}

      <div className="rounded-xl p-3" style={{ background: 'var(--surface-raised)' }}>
        <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
          AIと相談して微調整する(総額は変わりません)
        </p>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          maxLength={200}
          rows={2}
          placeholder="例:外食を減らして、その分を日用品に回したい(空欄なら見直し案を出します)"
          className="mt-1.5 w-full rounded-lg px-2 py-1.5 text-xs"
          style={{
            background: 'var(--surface)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />
        <Button
          variant="outlined"
          className="mt-2 w-full"
          disabled={total === null || !allValid || busy !== null}
          onClick={() => void consultAi()}
        >
          {busy === 'ai' ? 'AIが考えています…' : 'AIに微調整を相談する'}
        </Button>
        {aiSummary ? (
          <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {aiSummary}
          </p>
        ) : null}
      </div>

      <Button
        variant="filled"
        className="w-full"
        disabled={!balanced || busy !== null}
        onClick={() => void save()}
      >
        {busy === 'save' ? '保存しています…' : saveLabel}
      </Button>

      {error ? (
        <p className="text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
