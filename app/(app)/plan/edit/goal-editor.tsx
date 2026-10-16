'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { formatEstimate, formatProbability } from '@/domain/forecast/format';
import type { CumulativeDay } from '@/features/category/pace';
import { daysBetween } from '@/lib/date';
import { Switch } from '../../record-sheet';
import { reserveNextPlanAction, updatePlanAllocationAction } from '../actions';
import { DeletePlanButton } from '../delete-plan-button';
import { PlanPeriodForm } from '../edit-plan-section';
import { UnrecordedSheet, type AddableGenre, type UnrecordedRow } from '../unrecorded-sheet';
import { CategoryTargetSheet } from './category-target-sheet';

/** カテゴリ1つの、目標額と見通しの材料。 */
export type GoalCategory = {
  genreId: string;
  name: string;
  /** 保存されている目標額。 */
  targetYen: number;
  /** 期間のはじめから今日までに使った額。 */
  spentYen: number;
  lastMonthYen: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  /** 見直し候補(このままだと目標をこえそう)。probability はこえる確率。 */
  caution: { probability: number } | null;
  /** 行の2行目(「先月より大きく増えそう」「いまのペース 1日 約127円」など)。 */
  sub: string | null;
  /** 見通しのグラフ(実績・予測の帯)。 */
  days: readonly CumulativeDay[];
};

/** 総額の − / + の刻み。 */
const TOTAL_STEP = 1000;
/** 提案で見直し候補をへらす割合。 */
const CUT = 0.2;
/** 提案に出す見直し候補の数。 */
const MAX_PROPOSAL = 2;

const yen = (v: number) => `${v.toLocaleString('ja-JP')}円`;
const num = (v: number) => v.toLocaleString('ja-JP');

/** 2026-10-01 → 10月1日 */
function dayLabel(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

/** 合計が total になるように、各カテゴリを今の割合で配り直す(端数は大きい順に1円ずつ)。 */
function scaleTo(amounts: Record<string, number>, total: number): Record<string, number> {
  const ids = Object.keys(amounts);
  const sum = ids.reduce((s, id) => s + amounts[id]!, 0);
  if (ids.length === 0) return amounts;
  const base =
    sum > 0
      ? ids.map((id) => ({ id, exact: (amounts[id]! / sum) * total }))
      : ids.map((id) => ({ id, exact: total / ids.length }));
  const out: Record<string, number> = {};
  let left = total;
  for (const b of base) {
    out[b.id] = Math.floor(b.exact);
    left -= out[b.id]!;
  }
  const order = [...base].sort((a, b) => (b.exact % 1) - (a.exact % 1));
  for (let i = 0; i < left; i += 1) out[order[i % order.length]!.id]! += 1;
  return out;
}

/**
 * 今期の目標(デザイン仕様書の「今期の目標」、ADR-090)。変えた額は「保存」でまとめて保存する。
 * 総額の − / + と入力は、カテゴリを今の割合のまま配り直す。カテゴリを押すと目標額のシートを開く。
 */
export function GoalEditor({
  planId,
  periodStart,
  periodEnd,
  today,
  remainingDays,
  landing,
  categories,
  noBudget,
  addable,
  next,
}: {
  planId: string;
  periodStart: string;
  periodEnd: string;
  today: string;
  remainingDays: number;
  /** 保存されている目標での着地(中央)と予算内の確率。出せなければ null。 */
  landing: { p50: number; probWithin: number } | null;
  categories: readonly GoalCategory[];
  noBudget: readonly UnrecordedRow[];
  addable: readonly AddableGenre[];
  next: { start: string; reserved: boolean };
}) {
  const router = useRouter();
  const saved = Object.fromEntries(categories.map((c) => [c.genreId, c.targetYen]));
  const [amounts, setAmounts] = useState<Record<string, number>>(saved);
  const [totalText, setTotalText] = useState<string | null>(null);
  const [fixedTotal, setFixedTotal] = useState(true);
  const [applied, setApplied] = useState<Record<string, number> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reserving, setReserving] = useState(false);
  const [reserveNote, setReserveNote] = useState<string | null>(null);

  const total = Object.values(amounts).reduce((s, v) => s + v, 0);
  const savedTotal = Object.values(saved).reduce((s, v) => s + v, 0);
  const dirty = categories.some((c) => amounts[c.genreId] !== c.targetYen);
  const flagged = categories
    .filter((c) => c.caution !== null && c.targetYen > 0)
    .sort((a, b) => (b.p50 ?? 0) - (b.targetYen ?? 0) - ((a.p50 ?? 0) - a.targetYen))
    .slice(0, MAX_PROPOSAL);
  const proposal = Object.fromEntries(
    flagged.map((c) => [c.genreId, Math.round(c.targetYen * (1 - CUT))]),
  );
  const proposedTotal =
    savedTotal - flagged.reduce((s, c) => s + c.targetYen - proposal[c.genreId]!, 0);
  const ordered = [...categories].sort(
    (a, b) =>
      Number(b.caution !== null) - Number(a.caution !== null) ||
      (amounts[b.genreId] ?? 0) - (amounts[a.genreId] ?? 0),
  );

  const setTotal = (next: number) => {
    const clamped = Math.max(0, Math.round(next));
    setAmounts((prev) => scaleTo(prev, clamped));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await updatePlanAllocationAction(
      planId,
      categories.map((c) => ({ genreId: c.genreId, targetYen: amounts[c.genreId] ?? 0 })),
    );
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.push('/plan');
    router.refresh();
  };

  const editingCategory = categories.find((c) => c.genreId === editing) ?? null;
  const periodDays = daysBetween(periodStart, periodEnd) + 1;
  const overYen = landing ? landing.p50 - savedTotal : 0;

  return (
    <div className="rise flex flex-col gap-3" style={{ color: 'var(--ink)' }}>
      <div className="grid min-h-11 grid-cols-[1fr_auto_1fr] items-center">
        <Link
          href="/plan"
          className="flex min-h-11 items-center justify-self-start text-[17px]"
          style={{ color: 'var(--accent)' }}
        >
          キャンセル
        </Link>
        <h1 className="text-[17px] font-semibold">今期の目標</h1>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="flex min-h-11 items-center justify-self-end text-[17px] font-bold disabled:opacity-40"
          style={{ color: 'var(--accent)' }}
        >
          {saving ? '保存中' : '保存'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="px-1 text-[13px]" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}

      <section
        aria-live="polite"
        className="flex flex-col gap-1 rounded-[20px] px-5 py-4"
        style={{ background: 'var(--action)', color: 'var(--on-action)' }}
      >
        <span className="text-[13px] opacity-85">この目標で着地すると</span>
        {dirty || landing === null ? (
          <>
            <div className="tabular flex items-baseline justify-between gap-2">
              <span className="text-[28px] font-bold">
                目標 {formatEstimate(total, { approx: false })}
              </span>
              <span className="text-[15px]">{dirty ? '保存して再計算' : ''}</span>
            </div>
            <span className="text-[13px] opacity-85">
              {dirty
                ? '保存すると、着地と確率をここで計算し直します'
                : '記録がたまると、着地と確率を出せます'}
            </span>
          </>
        ) : (
          <>
            <div className="tabular flex items-baseline justify-between gap-2">
              <span className="text-[28px] font-bold">{formatEstimate(landing.p50)}</span>
              <span className="text-[15px]">
                予算内の確率 <strong>{formatProbability(landing.probWithin)}</strong>
              </span>
            </div>
            <span className="tabular text-[13px] opacity-85">
              目標 {formatEstimate(savedTotal, { approx: false })}より
              {formatEstimate(Math.abs(overYen))} {overYen > 0 ? '多い' : '少ない'}見込み
            </span>
          </>
        )}
      </section>

      <Caption>期間</Caption>
      <div className="-mt-1 rounded-2xl" style={{ background: 'var(--surface)' }}>
        <button
          type="button"
          onClick={() => setPeriodOpen(true)}
          className="flex min-h-13 w-full items-center gap-2 px-4 text-left"
        >
          <span className="tabular flex-1 text-[16px]">
            {dayLabel(periodStart)}〜{dayLabel(periodEnd)}
          </span>
          <span className="text-[15px]" style={{ color: 'var(--ink-muted)' }}>
            {periodDays}日間
          </span>
          <span style={{ color: 'var(--ideal)' }}>
            <ChevronRightIcon />
          </span>
        </button>
      </div>
      <p className="-mt-1 px-4 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        給料日に合わせるのがおすすめです。
      </p>

      <Caption>使っていい総額</Caption>
      <div className="-mt-1 flex flex-col rounded-2xl" style={{ background: 'var(--surface)' }}>
        <div className="flex items-center gap-3 px-4 py-3">
          <RoundButton label="1,000円へらす" onClick={() => setTotal(total - TOTAL_STEP)} minus />
          <label className="flex flex-1 items-baseline justify-center gap-1">
            <span className="sr-only">総額</span>
            <input
              inputMode="numeric"
              value={totalText ?? num(total)}
              onFocus={() => setTotalText(num(total))}
              onChange={(e) => setTotalText(e.target.value)}
              onBlur={() => {
                const v = Number((totalText ?? '').replace(/[^\d]/g, ''));
                if (Number.isFinite(v) && totalText !== null) setTotal(v);
                setTotalText(null);
              }}
              className="tabular w-40 bg-transparent text-right text-[34px] font-bold outline-none"
              style={{ color: 'var(--ink)' }}
            />
            <span className="text-[20px] font-semibold">円</span>
          </label>
          <RoundButton label="1,000円ふやす" onClick={() => setTotal(total + TOTAL_STEP)} />
        </div>
        <Divider />
        <label className="flex min-h-13 items-center justify-between gap-3 px-4 py-2">
          <span className="flex flex-col">
            <span className="text-[16px]">総額を固定</span>
            <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              カテゴリを動かすと、ほかで自動調整
            </span>
          </span>
          <Switch checked={fixedTotal} onChange={setFixedTotal} label="総額を固定" />
        </label>
      </div>

      {flagged.length > 0 && applied === null ? (
        <section
          aria-label="提案"
          className="mt-2 flex flex-col gap-2 rounded-[20px] px-4 pt-4 pb-4"
          style={{
            background: 'var(--surface)',
            boxShadow: 'inset 0 0 0 1.5px var(--suggest-line)',
          }}
        >
          <span
            className="flex items-center gap-1 text-[13px] font-semibold"
            style={{ color: 'var(--state-caution)' }}
          >
            <svg
              aria-hidden
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" />
            </svg>
            提案
          </span>
          <span className="text-[18px] font-bold">
            {flagged.map((c) => c.name).join('と')}を{Math.round(CUT * 100)}%へらす
          </span>
          <span className="text-[14px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {flagged.length === 1 ? 'ここが' : `この${flagged.length}つが`}
            見直し候補です。ほかのカテゴリは、いまのペースのままで大丈夫です。
          </span>
          <div
            className="tabular flex flex-col gap-1 rounded-xl px-3 py-3 text-[14px]"
            style={{ background: 'var(--note)' }}
          >
            {flagged.map((c) => (
              <span key={c.genreId} className="flex justify-between gap-2">
                <span>{c.name}</span>
                <span>
                  {num(c.targetYen)} → <strong>{yen(proposal[c.genreId]!)}</strong>
                </span>
              </span>
            ))}
            <span className="flex justify-between gap-2" style={{ color: 'var(--ink-muted)' }}>
              <span>総額</span>
              <span>
                {num(savedTotal)} → {yen(proposedTotal)}
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setApplied(amounts);
              setAmounts((prev) => ({ ...prev, ...proposal }));
            }}
            className="mt-1 min-h-11 rounded-full text-[15px] font-semibold"
            style={{ background: 'var(--action)', color: 'var(--on-action)' }}
          >
            提案を当てはめる
          </button>
        </section>
      ) : null}
      {applied !== null ? (
        <div
          className="mt-2 flex items-center justify-between gap-2 rounded-[14px] py-1 pr-2 pl-4"
          style={{ background: 'var(--income-track)' }}
        >
          <span className="text-[14px] font-semibold" style={{ color: 'var(--income)' }}>
            提案を当てはめました
          </span>
          <button
            type="button"
            onClick={() => {
              setAmounts(applied);
              setApplied(null);
            }}
            className="min-h-11 px-3 text-[15px] font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            元に戻す
          </button>
        </div>
      ) : null}

      <div className="flex items-baseline justify-between px-4 pt-2">
        <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          カテゴリへの配分 · {categories.length}
        </span>
        <span className="flex items-center gap-1 text-[13px]" style={{ color: 'var(--income)' }}>
          <svg
            aria-hidden
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12l5 5L20 7" />
          </svg>
          総額とぴったり
        </span>
      </div>
      <div
        className="-mt-1 flex flex-col rounded-2xl pt-4"
        style={{ background: 'var(--surface)' }}
      >
        <div
          aria-hidden
          className="mx-4 mb-2 flex h-3 overflow-hidden rounded-full"
          style={{ gap: 2 }}
        >
          {ordered.map((c, i) => (
            <span
              key={c.genreId}
              style={{
                flex: amounts[c.genreId] ?? 0,
                background: c.caution
                  ? i % 2 === 0
                    ? 'var(--future-fill)'
                    : 'var(--suggest-line)'
                  : `color-mix(in srgb, var(--accent) ${Math.max(15, 70 - i * 9)}%, var(--track))`,
              }}
            />
          ))}
        </div>
        {ordered.map((c, i) => (
          <button
            key={c.genreId}
            type="button"
            onClick={() => setEditing(c.genreId)}
            className="flex min-h-14 items-center gap-3 px-4 py-2 text-left"
            style={i > 0 ? { borderTop: '1px solid var(--hairline)' } : undefined}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2 text-[16px]">
                <span className="truncate">{c.name}</span>
                {c.caution && applied === null ? (
                  <span
                    className="shrink-0 rounded-full px-2 py-1 text-[11px] font-bold"
                    style={{
                      background: 'var(--state-caution-track)',
                      color: 'var(--state-caution)',
                    }}
                  >
                    見直し候補
                  </span>
                ) : null}
              </span>
              {c.sub ? (
                <span className="truncate text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                  {c.sub}
                </span>
              ) : null}
            </span>
            <span className="tabular text-[16px] font-semibold">
              {yen(amounts[c.genreId] ?? 0)}
            </span>
            <span style={{ color: 'var(--ideal)' }}>
              <ChevronRightIcon />
            </span>
          </button>
        ))}
      </div>

      <Caption>そのほか</Caption>
      <div className="-mt-1 flex flex-col rounded-2xl" style={{ background: 'var(--surface)' }}>
        <UnrecordedSheet planId={planId} rows={noBudget} addable={addable} />
        <Divider />
        <Link href="/settings/categories" className="flex min-h-13 items-center gap-2 px-4">
          <span className="flex-1 text-[16px]">カテゴリの設定</span>
          <span className="text-[15px]" style={{ color: 'var(--ink-muted)' }}>
            名前・色・ホーム表示
          </span>
          <span style={{ color: 'var(--ideal)' }}>
            <ChevronRightIcon />
          </span>
        </Link>
        <Divider />
        <button
          type="button"
          disabled={next.reserved || reserving}
          onClick={async () => {
            setReserving(true);
            const result = await reserveNextPlanAction(planId);
            setReserving(false);
            setReserveNote(result.error ?? `${dayLabel(next.start)}からの目標を予約しました。`);
            if (!result.error) router.refresh();
          }}
          className="flex min-h-13 items-center gap-2 px-4 text-left disabled:opacity-60"
        >
          <span className="flex flex-1 flex-col py-2">
            <span className="text-[16px]">次の期間の目標を予約</span>
            <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              {next.reserved
                ? `${dayLabel(next.start)}から · 予約済み`
                : `${dayLabel(next.start)}から · この目標を引き継いで作成`}
            </span>
          </span>
          <span style={{ color: 'var(--ideal)' }}>
            <ChevronRightIcon />
          </span>
        </button>
      </div>
      {reserveNote ? (
        <p role="status" className="px-4 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          {reserveNote}
        </p>
      ) : null}

      <div className="mt-5 rounded-2xl" style={{ background: 'var(--surface)' }}>
        <DeletePlanButton planId={planId} />
      </div>

      <BottomSheet open={periodOpen} onClose={() => setPeriodOpen(false)} label="期間" tall>
        <div className="flex flex-col gap-3 pt-1">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center">
            <button
              type="button"
              onClick={() => setPeriodOpen(false)}
              className="flex min-h-11 items-center justify-self-start text-[17px]"
              style={{ color: 'var(--accent)' }}
            >
              閉じる
            </button>
            <span className="text-[17px] font-semibold">期間</span>
            <span />
          </div>
          <div className="rounded-2xl px-4 py-4" style={{ background: 'var(--surface)' }}>
            <PlanPeriodForm planId={planId} periodStart={periodStart} periodEnd={periodEnd} />
          </div>
        </div>
      </BottomSheet>

      <BottomSheet
        open={editingCategory !== null}
        onClose={() => setEditing(null)}
        label={editingCategory ? `${editingCategory.name}の目標額` : 'カテゴリの目標額'}
        tall
      >
        {editingCategory ? (
          <CategoryTargetSheet
            key={editingCategory.genreId}
            category={editingCategory}
            amountYen={amounts[editingCategory.genreId] ?? 0}
            today={today}
            periodStart={periodStart}
            periodEnd={periodEnd}
            remainingDays={remainingDays}
            lowersTotalDefault={!fixedTotal}
            onCancel={() => setEditing(null)}
            onDone={(value, lowersTotal) => {
              setAmounts((prev) => {
                const id = editingCategory.genreId;
                if (lowersTotal) return { ...prev, [id]: value };
                // 総額はそのまま、差額をほかのカテゴリへ今の割合で配り直す。
                const others = Object.fromEntries(
                  Object.entries(prev).filter(([key]) => key !== id),
                );
                const rest = Object.values(prev).reduce((s, v) => s + v, 0) - value;
                return { ...scaleTo(others, Math.max(0, rest)), [id]: value };
              });
              setEditing(null);
            }}
          />
        ) : null}
      </BottomSheet>
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-4 pt-2 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
      {children}
    </span>
  );
}

function Divider() {
  return <div className="ml-4 h-px" style={{ background: 'var(--hairline)' }} />;
}

/** 丸い − / + のボタン。 */
export function RoundButton({
  label,
  onClick,
  minus = false,
  size = 11,
}: {
  label: string;
  onClick: () => void;
  minus?: boolean;
  size?: 11 | 12;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`flex min-h-11 shrink-0 items-center justify-center rounded-full ${size === 12 ? 'size-12' : 'size-11'}`}
      style={{ background: 'var(--plane)', color: 'var(--ink)' }}
    >
      <svg
        aria-hidden
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      >
        <path d={minus ? 'M6 12h12' : 'M12 6v12M6 12h12'} />
      </svg>
    </button>
  );
}
