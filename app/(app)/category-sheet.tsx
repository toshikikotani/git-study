'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { GenreBadge } from '@/components/ui/genre-badge';
import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { Switch } from '@/components/ui/switch';
import { formatEstimate } from '@/domain/forecast/format';
import type { CumulativeDay } from '@/features/category/pace';
import {
  loadCategorySheetAction,
  saveCategoryTargetAction,
  type CategorySheetData,
} from './category-sheet-actions';
import { setCategoryFixedAction, setCategoryShowOnHomeAction } from './spending/category/actions';

/** 目標額の − / + の刻みと、スライダーの刻み。 */
const STEP = 500;
const SLIDER_STEP = 100;
const yen = (v: number) => `${Math.round(v).toLocaleString('ja-JP')}円`;

/** 2026-10-16 → 10/16 */
function md(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

type OpenCategory = (genreId: string) => void;
const CategorySheetContext = createContext<OpenCategory>(() => undefined);

/** カテゴリのマーク・行から⑦を開く(どこで押しても同じシート、ADR-091)。 */
export function useOpenCategory(): OpenCategory {
  return useContext(CategorySheetContext);
}

/**
 * カテゴリのシート(デザイン仕様書の⑦「カテゴリ」、ADR-091)を、アプリのどこからでも開けるようにする。
 * 開くとサーバーから今期の様子を読み、「完了」で目標額を保存する。
 */
export function CategorySheetProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [genreId, setGenreId] = useState<string | null>(null);
  const [data, setData] = useState<CategorySheetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const open = useCallback((id: string) => {
    setGenreId(id);
    setData(null);
    setError(null);
    void loadCategorySheetAction(id).then((result) => {
      setData(result.data);
      setError(result.error);
    });
  }, []);
  const close = () => {
    setGenreId(null);
    setData(null);
  };

  return (
    <CategorySheetContext.Provider value={open}>
      {children}
      <BottomSheet open={genreId !== null} onClose={close} label="カテゴリ" tall>
        {data ? (
          <CategorySheetBody
            key={data.outlook.genreId}
            data={data}
            saving={saving}
            error={error}
            onCancel={close}
            onDone={async (amount) => {
              const target = data.outlook.targetYen;
              if (amount === null || data.planId === null || amount === target) {
                close();
                router.refresh();
                return;
              }
              setSaving(true);
              const result = await saveCategoryTargetAction({
                planId: data.planId,
                genreId: data.outlook.genreId,
                targetYen: amount,
                inPlan: target !== null,
                floorYen: data.outlook.spentYen,
              });
              setSaving(false);
              if (result.error) {
                setError(result.error);
                return;
              }
              close();
              router.refresh();
            }}
          />
        ) : (
          <div className="flex flex-col gap-3 pt-1 pb-8">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center">
              <button
                type="button"
                onClick={close}
                className="flex min-h-11 items-center justify-self-start text-[17px]"
                style={{ color: 'var(--accent)' }}
              >
                キャンセル
              </button>
              <span className="text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
                カテゴリ
              </span>
              <span />
            </div>
            <p role="status" className="px-1 text-[15px]" style={{ color: 'var(--ink-muted)' }}>
              {error ?? '読み込んでいます…'}
            </p>
          </div>
        )}
      </BottomSheet>
    </CategorySheetContext.Provider>
  );
}

/** カテゴリのマーク(押すと⑦)。行の中で、行そのものとは別に押せる。 */
export function CategoryMark({
  genreId,
  name,
  size = 36,
}: {
  genreId: string | null;
  name: string | null;
  size?: number;
}) {
  const open = useOpenCategory();
  if (genreId === null) return <GenreBadge name={name} size={size} />;
  return (
    <button
      type="button"
      aria-label={`${name ?? 'カテゴリ'}を開く`}
      onClick={(e) => {
        e.stopPropagation();
        open(genreId);
      }}
      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
    >
      <GenreBadge name={name} size={size} />
    </button>
  );
}

/**
 * ⑦の中身:マークと名前・これまでと先月 → 見通し → 今期の目標額(使った額が下限)→ 設定。
 * 今期の目標(⑥)の中から開いたときも同じ中身で、「完了」の額は⑥の配分に入る。
 */
export function CategorySheetBody({
  data,
  amountYen,
  saving = false,
  error = null,
  onCancel,
  onDone,
}: {
  data: CategorySheetData;
  /** 今の額(⑥の中で変えている途中の額)。無ければ保存されている目標額。 */
  amountYen?: number;
  saving?: boolean;
  error?: string | null;
  onCancel: () => void;
  /** 目標が無ければ null。 */
  onDone: (amountYen: number | null) => void | Promise<void>;
}) {
  const { outlook } = data;
  const floor = outlook.spentYen;
  const initial =
    amountYen ??
    outlook.targetYen ??
    Math.max(floor, Math.round((outlook.p50 ?? floor) / SLIDER_STEP) * SLIDER_STEP);
  const [amount, setAmountRaw] = useState(Math.max(floor, initial));
  const setAmount = (v: number) => setAmountRaw(Math.max(floor, Math.round(v)));
  const [fixed, setFixed] = useState(data.isFixed);
  const [home, setHome] = useState(data.showOnHome);
  const [settingError, setSettingError] = useState<string | null>(null);
  const name = outlook.name;
  const hasPlan = data.planId !== null;
  const presets = [
    ...(outlook.targetYen !== null ? [{ label: 'いまのまま', value: outlook.targetYen }] : []),
    ...(outlook.targetYen !== null
      ? [{ label: '20%へらす', value: Math.round(outlook.targetYen * 0.8) }]
      : []),
    { label: '使った分だけ', value: floor },
  ].filter((p) => p.value >= floor);
  const max = useMemo(
    () =>
      Math.max(
        60000,
        Math.ceil((Math.max(outlook.targetYen ?? 0, outlook.p90 ?? 0, floor) * 1.5) / STEP) * STEP,
      ),
    [outlook.targetYen, outlook.p90, floor],
  );
  const left = amount - outlook.spentYen;
  const over = outlook.p50 !== null ? outlook.p50 - amount : null;
  const atFloor = amount <= floor;

  const toggle = async (
    next: boolean,
    set: (v: boolean) => void,
    save: () => Promise<{ error: string | null }>,
  ) => {
    set(next);
    setSettingError(null);
    const result = await save();
    if (result.error) {
      set(!next);
      setSettingError(result.error);
    }
  };

  return (
    <div className="flex flex-col gap-3 pt-1" style={{ color: 'var(--ink)' }}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <button
          type="button"
          onClick={onCancel}
          className="flex min-h-11 items-center justify-self-start text-[17px]"
          style={{ color: 'var(--accent)' }}
        >
          キャンセル
        </button>
        <span className="text-[17px] font-semibold">カテゴリ</span>
        <button
          type="button"
          disabled={saving}
          onClick={() => void onDone(hasPlan ? amount : null)}
          className="flex min-h-11 items-center justify-self-end text-[17px] font-bold disabled:opacity-40"
          style={{ color: 'var(--accent)' }}
        >
          {saving ? '保存中' : '完了'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="px-1 text-[13px]" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-4 px-1 pt-1">
        <GenreBadge name={name} size={56} />
        <span className="tabular flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[24px] font-bold">{name}</span>
          <span className="text-[14px]" style={{ color: 'var(--ink-muted)' }}>
            これまで {yen(outlook.spentYen)}
            {outlook.lastMonthYen !== null ? ` · 先月 ${yen(outlook.lastMonthYen)}` : ''}
          </span>
        </span>
      </div>

      <Heading>見通し</Heading>
      <section
        className="flex flex-col rounded-[20px] px-4 pt-4 pb-3"
        style={{ background: 'var(--surface)' }}
      >
        {over !== null ? (
          <div className="flex justify-end">
            <span
              className="rounded-full px-2 py-1 text-[12px] font-bold"
              style={
                over > 0
                  ? { background: 'var(--state-caution-track)', color: 'var(--state-caution)' }
                  : { background: 'var(--income-track)', color: 'var(--income)' }
              }
            >
              {over > 0
                ? `このままだと${formatEstimate(over)}こえそう`
                : 'このペースなら収まりそう'}
            </span>
          </div>
        ) : null}
        <CategoryChart
          days={outlook.days}
          target={hasPlan ? amount : null}
          name={name}
          endLabel={md(data.periodEnd)}
          p50={outlook.p50}
        />
        <div
          className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]"
          style={{ color: 'var(--ink-secondary)' }}
        >
          <Legend
            swatch={<span className="h-1 w-4 rounded-sm" style={{ background: 'var(--accent)' }} />}
          >
            使った額
          </Legend>
          <Legend
            swatch={
              <span className="w-4" style={{ borderTop: '2px dashed var(--caution-mark)' }} />
            }
          >
            いまのペース
          </Legend>
          <Legend
            swatch={
              <span className="h-3 w-4 rounded-sm" style={{ background: 'var(--band-outer)' }} />
            }
          >
            10回中8回の幅
          </Legend>
          {hasPlan ? (
            <Legend
              swatch={<span className="w-4" style={{ borderTop: '2px dotted var(--accent)' }} />}
            >
              目標までのペース
            </Legend>
          ) : null}
        </div>
      </section>

      <Heading>今期の目標額</Heading>
      {hasPlan ? (
        <section
          className="flex flex-col gap-3 rounded-[20px] p-4"
          style={{ background: 'var(--surface)' }}
        >
          <div className="flex items-center justify-between">
            <RoundButton
              label={`${STEP}円へらす`}
              onClick={() => setAmount(amount - STEP)}
              disabled={atFloor}
              minus
            />
            <span className="tabular flex items-baseline gap-1">
              <span className="text-[40px] font-bold tracking-[-0.01em]">
                {amount.toLocaleString('ja-JP')}
              </span>
              <span className="text-[20px] font-semibold">円</span>
            </span>
            <RoundButton label={`${STEP}円ふやす`} onClick={() => setAmount(amount + STEP)} />
          </div>
          <input
            type="range"
            min={floor}
            max={Math.max(max, amount)}
            step={SLIDER_STEP}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            aria-label={`${name}の目標額`}
            className="min-h-11 w-full"
            style={{ accentColor: 'var(--accent)' }}
          />
          <span
            className="tabular -mt-2 flex justify-between text-[12px]"
            style={{ color: 'var(--ink-muted)' }}
          >
            <span>下限 {yen(floor)}（使った額）</span>
            <span>{yen(Math.max(max, amount))}</span>
          </span>
          <div className="grid grid-cols-3 gap-2">
            {presets.map((p) => {
              const on = p.value === amount;
              return (
                <button
                  key={p.label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setAmount(p.value)}
                  className="tabular flex min-h-14 flex-col items-center justify-center rounded-[14px]"
                  style={{
                    background: on ? 'var(--action)' : 'var(--plane)',
                    color: on ? 'var(--on-action)' : 'var(--ink)',
                  }}
                >
                  <span className="text-[12px] font-semibold">{p.label}</span>
                  <span className="text-[15px] font-bold">{p.value.toLocaleString('ja-JP')}</span>
                </button>
              );
            })}
          </div>
          <p
            className="tabular rounded-xl px-4 py-3 text-center text-[14px] leading-relaxed"
            style={{ background: 'var(--note)', color: 'var(--ink-secondary)' }}
          >
            {left > 0
              ? data.remainingDays > 0
                ? `残り${data.remainingDays}日で、${name}に使えるのは1日 約${yen(left / data.remainingDays)}`
                : `${name}はあと${yen(left)}使えます`
              : `この金額だと、残りの${name}は0円です`}
          </p>
        </section>
      ) : (
        <section
          className="flex flex-col gap-2 rounded-[20px] p-4"
          style={{ background: 'var(--surface)' }}
        >
          <p className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
            今期の目標を作ると、ここでカテゴリの目標額を決められます。
          </p>
          <Link
            href="/reports"
            onClick={onCancel}
            className="flex min-h-11 items-center text-[15px] font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            目標をつくる
          </Link>
        </section>
      )}

      <Heading>設定</Heading>
      <div className="flex flex-col rounded-2xl" style={{ background: 'var(--surface)' }}>
        <Link
          href={`/settings/categories/${outlook.genreId}` as Route}
          onClick={onCancel}
          className="flex min-h-13 items-center gap-2 px-4"
        >
          <span className="flex-1 text-[16px]">名前・マーク・色</span>
          <span style={{ color: 'var(--ideal)' }}>
            <ChevronRightIcon />
          </span>
        </Link>
        <Divider />
        <label className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
          <span className="flex flex-col">
            <span className="text-[16px]">固定費にする</span>
            <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              毎月かならず出ていくもの
            </span>
          </span>
          <Switch
            checked={fixed}
            onChange={(next) =>
              void toggle(next, setFixed, () => setCategoryFixedAction(outlook.genreId, next))
            }
            label="固定費にする"
          />
        </label>
        <Divider />
        <label className="flex min-h-13 items-center justify-between gap-3 px-4">
          <span className="text-[16px]">ホームに表示</span>
          <Switch
            checked={home}
            onChange={(next) =>
              void toggle(next, setHome, () => setCategoryShowOnHomeAction(outlook.genreId, next))
            }
            label="ホームに表示"
          />
        </label>
      </div>
      {settingError ? (
        <p role="alert" className="px-1 text-[13px]" style={{ color: 'var(--over)' }}>
          {settingError}
        </p>
      ) : null}
      <div className="h-4" />
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mx-1 mt-2 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
      {children}
    </h2>
  );
}

function Divider() {
  return <div className="ml-4 h-px" style={{ background: 'var(--hairline)' }} />;
}

function Legend({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      {swatch}
      {children}
    </span>
  );
}

/** 丸い − / + のボタン(48px)。 */
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
      className="flex size-12 min-h-11 shrink-0 items-center justify-center rounded-full disabled:opacity-35"
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

/** 使った額・いまのペース(中央)と10回中8回の幅・目標の点線・目標までのペース。 */
export function CategoryChart({
  days,
  target,
  name,
  endLabel,
  p50,
}: {
  days: readonly CumulativeDay[];
  /** 目標額。目標が無ければ null(目標の線を描かない)。 */
  target: number | null;
  name: string;
  endLabel: string;
  p50: number | null;
}) {
  const W = 326;
  const top = 14;
  const bottom = 150;
  const x0 = 8;
  const x1 = 290;
  const n = days.length;
  if (n === 0) return null;
  let last = -1;
  for (let i = 0; i < n; i += 1) if (days[i]!.actualYen !== null) last = i;
  const peak = Math.max(
    target ?? 0,
    ...days.map((d) => Math.max(d.actualYen ?? 0, d.forecastHighYen ?? 0)),
    1,
  );
  const max = peak * 1.1;
  const x = (i: number) => x0 + (n <= 1 ? 0 : (i / (n - 1)) * (x1 - x0));
  const y = (v: number) => bottom - (Math.min(v, max) / max) * (bottom - top);
  const pt = (i: number, v: number) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  const spent = last >= 0 ? (days[last]!.actualYen ?? 0) : 0;
  const origin = pt(Math.max(0, last), spent);
  const future = days.filter((d) => d.index > last && d.forecastYen !== null);
  const band =
    future.length > 0
      ? `M${origin} L${future.map((d) => pt(d.index, d.forecastHighYen ?? d.forecastYen!)).join(' L')} L${[
          ...future,
        ]
          .reverse()
          .map((d) => pt(d.index, d.forecastLowYen ?? d.forecastYen!))
          .join(' L')} Z`
      : null;
  const end = future.at(-1);
  const median =
    future.length > 0
      ? `M${origin} L${future.map((d) => pt(d.index, d.forecastYen!)).join(' L')}`
      : null;
  const actual =
    last >= 0
      ? `M${days
          .slice(0, last + 1)
          .map((d) => pt(d.index, d.actualYen ?? 0))
          .join(' L')}`
      : null;
  const ty = target !== null ? y(target) : null;
  const man = (v: number) => formatEstimate(v, { approx: false }).replace('円', '');

  return (
    <svg
      viewBox={`0 0 ${W} 172`}
      width="100%"
      role="img"
      aria-label={`${name}はこれまで${yen(spent)}。${p50 !== null ? `いまのペースだと${endLabel}に${formatEstimate(p50)}。` : ''}${target !== null ? `目標は${yen(target)}。` : ''}`}
      className="mt-3"
      style={{ overflow: 'visible' }}
    >
      <line x1={x0} y1={bottom} x2={x1} y2={bottom} stroke="var(--bar-quiet)" />
      {band ? <path d={band} fill="var(--band-outer)" /> : null}
      {median ? (
        <path
          d={median}
          fill="none"
          stroke="var(--caution-mark)"
          strokeWidth="2"
          strokeDasharray="5 4"
        />
      ) : null}
      {end && end.forecastYen !== null ? (
        <>
          <circle
            cx={x(end.index)}
            cy={y(end.forecastYen)}
            r="3.5"
            fill="var(--surface)"
            stroke="var(--caution-mark)"
            strokeWidth="2"
          />
          {ty === null || Math.abs(y(end.forecastYen) - ty) > 12 ? (
            <text
              x="296"
              y={y(end.forecastYen) + 4}
              fontSize="11"
              fill="var(--state-caution)"
              fontWeight="600"
            >
              {man(end.forecastYen)}
            </text>
          ) : null}
        </>
      ) : null}
      {ty !== null ? (
        <>
          <line
            x1={x0}
            y1={ty}
            x2={x1}
            y2={ty}
            stroke="var(--ink)"
            strokeWidth="1.4"
            strokeDasharray="4 4"
          />
          <text x="296" y={Math.max(ty + 4, 12)} fontSize="11" fill="var(--ink)" fontWeight="700">
            目標
          </text>
        </>
      ) : null}
      {ty !== null && target !== null && last >= 0 && last < n - 1 && target > spent ? (
        <line
          x1={x(last)}
          y1={y(spent)}
          x2={x1}
          y2={ty}
          stroke="var(--accent)"
          strokeWidth="2"
          strokeDasharray="1.5 4"
          strokeLinecap="round"
        />
      ) : null}
      {last >= 0 && last < n - 1 ? (
        <>
          <line
            x1={x(last)}
            y1="14"
            x2={x(last)}
            y2={bottom}
            stroke="var(--bar-quiet)"
            strokeDasharray="2 3"
          />
          <text x={x(last)} y="9" fontSize="11" fill="var(--ink-muted)" textAnchor="middle">
            今日
          </text>
        </>
      ) : null}
      {actual ? (
        <>
          <path
            d={actual}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle
            cx={x(last)}
            cy={y(spent)}
            r="5"
            fill="var(--accent)"
            stroke="var(--surface)"
            strokeWidth="2"
          />
        </>
      ) : null}
      <text x={x0} y="166" fontSize="11" fill="var(--ink-muted)">
        {md(days[0]!.date)}
      </text>
      {last > 0 && last < n - 1 ? (
        <text x={x(last)} y="166" fontSize="11" fill="var(--ink-muted)" textAnchor="middle">
          {md(days[last]!.date)}
        </text>
      ) : null}
      <text x={x1} y="166" fontSize="11" fill="var(--ink-muted)" textAnchor="end">
        {endLabel}
      </text>
    </svg>
  );
}
