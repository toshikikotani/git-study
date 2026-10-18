'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { BottomSheet, BottomSheetHeader } from '@/components/ui/bottom-sheet';
import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { formatEstimate, formatProbability } from '@/domain/forecast/format';
import type { CategoryOutlook } from '@/features/goals/category-outlook';
import { daysBetween } from '@/lib/date';
import { Switch } from '@/components/ui/switch';
import { reserveNextPlanAction, updatePlanDraftAction } from '../actions';
import { DeletePlanButton } from '../delete-plan-button';
import { PlanPeriodForm } from '../edit-plan-section';
import { UnrecordedSheet, type AddableGenre, type UnrecordedRow } from '../unrecorded-sheet';
import { CategorySheetBody } from '../../category-sheet';

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

/**
 * 合計が total になるように配り直す。各カテゴリは下限(使った額と予定)を下回らない。下限を超える分を、
 * 今の割合で配る(端数は大きい順に1円ずつ)。total が下限の合計より小さければ、下限の合計にする。
 */
function scaleTo(
  amounts: Record<string, number>,
  total: number,
  floors: Record<string, number> = {},
): Record<string, number> {
  const ids = Object.keys(amounts);
  if (ids.length === 0) return amounts;
  const floorOf = (id: string) => Math.min(floors[id] ?? 0, Number.MAX_SAFE_INTEGER);
  const floorSum = ids.reduce((s, id) => s + floorOf(id), 0);
  const room = Math.max(0, total - floorSum);
  const excess = ids.map((id) => ({ id, yen: Math.max(0, amounts[id]! - floorOf(id)) }));
  const sum = excess.reduce((s, e) => s + e.yen, 0);
  const base =
    sum > 0
      ? excess.map((e) => ({ id: e.id, exact: (e.yen / sum) * room }))
      : excess.map((e) => ({ id: e.id, exact: room / ids.length }));
  const out: Record<string, number> = {};
  let left = room;
  for (const b of base) {
    const whole = Math.floor(b.exact);
    out[b.id] = floorOf(b.id) + whole;
    left -= whole;
  }
  const order = [...base].sort((a, b) => (b.exact % 1) - (a.exact % 1));
  for (let i = 0; i < left; i += 1) out[order[i % order.length]!.id]! += 1;
  return out;
}

/**
 * 今期の目標(デザイン仕様書の「今期の目標」、ADR-090・091)。変えた額は「保存」でまとめて保存する。
 * 総額の − / + と入力は、カテゴリを今の割合のまま配り直す(使った額と予定より下にはできない)。
 * カテゴリを押すと⑦カテゴリのシートを開き、「完了」の額がここの配分に入る。
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
  settings,
}: {
  planId: string;
  periodStart: string;
  periodEnd: string;
  today: string;
  remainingDays: number;
  /** 保存されている目標での着地(中央)と予算内の確率。出せなければ null。 */
  landing: { p50: number; probWithin: number } | null;
  categories: readonly CategoryOutlook[];
  noBudget: readonly UnrecordedRow[];
  addable: readonly AddableGenre[];
  next: { start: string; reserved: boolean };
  /** カテゴリの設定(固定費)。⑦のスイッチの初めの状態。 */
  settings: Readonly<Record<string, { isFixed: boolean }>>;
}) {
  const router = useRouter();
  const saved = Object.fromEntries(categories.map((c) => [c.genreId, c.targetYen ?? 0]));
  // カテゴリの下限も総額の下限も、使った額と予定の合計(デザイン v3-5、ADR-108)。
  const floors = Object.fromEntries(
    categories.map((c) => [c.genreId, c.spentYen + c.scheduledYen]),
  );
  const totalFloor = categories.reduce((s, c) => s + c.spentYen + c.scheduledYen, 0);
  const [amounts, setAmounts] = useState<Record<string, number>>(saved);
  const [period, setPeriod] = useState({ start: periodStart, end: periodEnd });
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
  const dirty =
    totalText !== null ||
    period.start !== periodStart ||
    period.end !== periodEnd ||
    categories.some((c) => amounts[c.genreId] !== (c.targetYen ?? 0));
  const overshoot = (c: CategoryOutlook) => (c.p50 ?? 0) - (c.targetYen ?? 0);
  const flagged = categories
    .filter((c) => c.caution !== null && (c.targetYen ?? 0) > 0)
    .sort((a, b) => overshoot(b) - overshoot(a))
    .slice(0, MAX_PROPOSAL);
  const proposal = Object.fromEntries(
    flagged.map((c) => [
      c.genreId,
      Math.max(c.spentYen + c.scheduledYen, Math.round((c.targetYen ?? 0) * (1 - CUT))),
    ]),
  );
  const proposedTotal =
    savedTotal - flagged.reduce((s, c) => s + (c.targetYen ?? 0) - proposal[c.genreId]!, 0);
  const ordered = [...categories].sort(
    (a, b) =>
      Number(b.caution !== null) - Number(a.caution !== null) ||
      (amounts[b.genreId] ?? 0) - (amounts[a.genreId] ?? 0),
  );

  const setTotal = (next: number) => {
    const clamped = Math.max(totalFloor, Math.round(next));
    setAmounts((prev) => scaleTo(prev, clamped, floors));
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const committed =
      totalText === null
        ? amounts
        : scaleTo(amounts, Math.max(totalFloor, Number(totalText.replace(/[^\d]/g, ''))), floors);
    try {
      const result = await updatePlanDraftAction(planId, {
        periodStart: period.start,
        periodEnd: period.end,
        items: categories
          .filter((c) => committed[c.genreId] !== (c.targetYen ?? 0))
          .map((c) => ({ genreId: c.genreId, targetYen: committed[c.genreId] ?? 0 })),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push('/reports');
    } catch {
      setError('保存を確認できませんでした。入力内容は残っています。もう一度お試しください。');
    } finally {
      setSaving(false);
    }
  };

  const editingCategory = categories.find((c) => c.genreId === editing) ?? null;
  const periodDays = period.start && period.end ? daysBetween(period.start, period.end) + 1 : 0;
  const overYen = landing ? landing.p50 - savedTotal : 0;

  return (
    <div className="rise flex flex-col gap-3" style={{ color: 'var(--ink)' }}>
      <div className="grid min-h-11 grid-cols-[1fr_auto_1fr] items-center">
        <Link
          href="/reports"
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
      <p className="px-4 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
        期間・総額・配分は「保存」でまとめて反映します。キャンセルすると未保存の編集を破棄します。
      </p>
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
                目標内の確率 <strong>{formatProbability(landing.probWithin)}</strong>
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
            {period.start ? dayLabel(period.start) : '開始日を選択'}〜
            {period.end ? dayLabel(period.end) : '終了日を選択'}
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
      {period.start !== periodStart || period.end !== periodEnd ? (
        <p role="status" className="px-4 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          使った額・予定・見通しは、保存すると変更後の期間で更新します。
        </p>
      ) : null}

      <Caption>使っていい総額</Caption>
      <div className="-mt-1 flex flex-col rounded-2xl" style={{ background: 'var(--surface)' }}>
        <div className="flex items-center gap-3 px-4 py-3">
          <RoundButton
            label="1,000円へらす"
            onClick={() => setTotal(total - TOTAL_STEP)}
            disabled={total <= totalFloor}
            minus
          />
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
      <p className="-mt-1 px-4 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        使った額と予定（{yen(totalFloor)}）より下にはできません。
      </p>

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
                  {num(c.targetYen ?? 0)} → <strong>{yen(proposal[c.genreId]!)}</strong>
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

      <Caption>そのほか · ここからの操作はその場で反映</Caption>
      <p className="px-4 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
        カテゴリ追加・設定・予約・削除は独立した操作です。編集を保存してから進めてください。
      </p>
      <div className="-mt-1 flex flex-col rounded-2xl" style={{ background: 'var(--surface)' }}>
        {dirty ? (
          <p className="px-4 py-3 text-[14px]" style={{ color: 'var(--ink-muted)' }}>
            カテゴリを追加するには、先に上部の「保存」で編集を保存してください。
          </p>
        ) : (
          <UnrecordedSheet planId={planId} rows={noBudget} addable={addable} />
        )}
        <Divider />
        <Link href="/settings/categories" className="flex min-h-13 items-center gap-2 px-4">
          <span className="flex-1 text-[16px]">カテゴリの設定</span>
          <span className="text-[15px]" style={{ color: 'var(--ink-muted)' }}>
            名前・色・並び順
          </span>
          <span style={{ color: 'var(--ideal)' }}>
            <ChevronRightIcon />
          </span>
        </Link>
        <Divider />
        <button
          type="button"
          disabled={dirty || saving || next.reserved || reserving}
          onClick={async () => {
            setReserving(true);
            const result = await reserveNextPlanAction(planId);
            setReserving(false);
            setReserveNote(result.error ?? `${dayLabel(next.start)}からの目標を予約しました。`);
          }}
          className="flex min-h-13 items-center gap-2 px-4 text-left disabled:opacity-60"
        >
          <span className="flex flex-1 flex-col py-2">
            <span className="text-[16px]">次の期間の目標を予約</span>
            <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              {dirty
                ? '先に上部の「保存」で期間・総額・配分を保存してください'
                : next.reserved
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
        <div className="flex flex-col gap-3">
          <BottomSheetHeader className="grid grid-cols-[1fr_auto_1fr] items-center pt-1">
            <button
              type="button"
              onClick={() => setPeriodOpen(false)}
              className="flex min-h-11 items-center justify-self-start text-[17px]"
              style={{ color: 'var(--accent)' }}
            >
              閉じる
            </button>
            <span className="text-[17px] font-semibold">期間を調整</span>
            <span />
          </BottomSheetHeader>
          <div className="rounded-2xl px-4 py-4" style={{ background: 'var(--surface)' }}>
            <PlanPeriodForm
              periodStart={period.start}
              periodEnd={period.end}
              onChange={setPeriod}
            />
          </div>
        </div>
      </BottomSheet>

      <BottomSheet
        open={editingCategory !== null}
        onClose={() => setEditing(null)}
        label={editingCategory ? editingCategory.name : 'カテゴリ'}
        tall
      >
        {editingCategory ? (
          <CategorySheetBody
            key={editingCategory.genreId}
            data={{
              outlook: editingCategory,
              planId,
              periodStart,
              periodEnd,
              today,
              remainingDays,
              isFixed: settings[editingCategory.genreId]?.isFixed ?? false,
              planTotalYen: Object.values(amounts).reduce((sum, v) => sum + v, 0),
            }}
            amountYen={amounts[editingCategory.genreId] ?? 0}
            onCancel={() => setEditing(null)}
            onDone={(value) => {
              if (value === null) {
                setEditing(null);
                return;
              }
              setAmounts((prev) => {
                const id = editingCategory.genreId;
                if (!fixedTotal) return { ...prev, [id]: value };
                // 総額を固定:差額をほかのカテゴリへ今の割合で配り直す(下限は守る)。
                const others = Object.fromEntries(
                  Object.entries(prev).filter(([key]) => key !== id),
                );
                const rest = Object.values(prev).reduce((s, v) => s + v, 0) - value;
                return { ...scaleTo(others, Math.max(0, rest), floors), [id]: value };
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
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  minus?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-11 min-h-11 shrink-0 items-center justify-center rounded-full disabled:opacity-35"
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
