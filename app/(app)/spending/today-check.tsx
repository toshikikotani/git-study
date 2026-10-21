'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { BottomSheet, BottomSheetHeader } from '@/components/ui/bottom-sheet';
import { formatYen } from '@/domain/money';
import type { CheckUndo, TodayCheckItem } from '@/features/today-check/store';
import { hapticFor } from '@/lib/haptics';
import { fetchQuickEntryGenresAction } from '../transactions/new/actions';
import { visibleGenres } from '../record-sheet';
import {
  applyTodayCheckAction,
  listTodayCheckAction,
  splitMergedPaymentAction,
  todayCheckSummaryAction,
  undoTodayCheckAction,
} from './today-check-actions';

/** スワイプで決まる距離(px)。これより短ければ元の位置に戻す。 */
const SWIPE_PX = 96;

type Done = { item: TodayCheckItem; action: 'confirm' | 'correct' | 'ignore'; undo: CheckUndo };
type Summary = { spentTodayYen: number | null; tomorrowYen: number | null };

/**
 * 今日の答え合わせ(デザイン v4-1、ADR-129)。自動で入った今日の記録を1枚ずつ出し、右で「合ってる」、
 * 左で「直す」、上で「数えない」。スワイプは近道で、同じ操作を下のボタンでもできる(VoiceOver でも
 * 最後まで終えられる)。「ひとつ戻る」で直前の1件を元に戻す。終わったら、確かめた件数・直した件数・
 * 今日の支出・明日からの目安を出す。「確認が必要」と同じデータなので、どちらで片づけても両方から消える。
 */
export function TodayCheckSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [items, setItems] = useState<TodayCheckItem[] | null>(null);
  const [done, setDone] = useState<Done[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [openedAt, setOpenedAt] = useState<boolean>(false);

  if (open !== openedAt) {
    setOpenedAt(open);
    if (open) {
      setItems(null);
      setDone([]);
      setError(null);
      setPicking(false);
      setSummary(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void listTodayCheckAction().then((result) => {
      if (!alive) return;
      setItems(result.items);
      setError(result.error);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  const current = items?.[0] ?? null;
  const finished = items !== null && items.length === 0 && done.length > 0;

  useEffect(() => {
    if (!finished || summary !== null) return;
    let alive = true;
    void todayCheckSummaryAction().then((s) => {
      if (alive) setSummary(s);
    });
    return () => {
      alive = false;
    };
  }, [finished, summary]);

  const act = async (action: Done['action'], genreId?: string) => {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    const result = await applyTodayCheckAction({
      id: current.id,
      action,
      genreId: genreId ?? null,
    });
    setBusy(false);
    if (result.error || !result.undo) {
      setError(result.error ?? '保存できませんでした。');
      return;
    }
    hapticFor(action === 'ignore' ? 'categoryMove' : 'genreConfirm');
    setDone((prev) => [...prev, { item: current, action, undo: result.undo! }]);
    setItems((prev) => (prev ?? []).slice(1));
    setPicking(false);
  };

  const undoLast = async () => {
    const last = done.at(-1);
    if (!last || busy) return;
    setBusy(true);
    setError(null);
    const result = await undoTodayCheckAction(last.undo);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDone((prev) => prev.slice(0, -1));
    setItems((prev) => [last.item, ...(prev ?? [])]);
    setSummary(null);
    setPicking(false);
  };

  const split = async () => {
    if (!current || busy) return;
    setBusy(true);
    const result = await splitMergedPaymentAction(current.id);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    // 分けたあとは、レシートの方も確かめる対象に戻るので読み直す。
    const next = await listTodayCheckAction();
    setItems(next.items);
  };

  const close = () => {
    onClose();
    if (done.length > 0) router.refresh();
  };

  const remaining = items?.length ?? 0;
  const position = done.length + 1;
  const total = done.length + remaining;

  return (
    <BottomSheet open={open} onClose={close} label="今日の答え合わせ" tall>
      <BottomSheetHeader className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => void undoLast()}
          disabled={done.length === 0 || busy}
          className="min-h-11 px-1 text-[15px] font-semibold disabled:opacity-30"
          style={{ color: 'var(--accent)' }}
        >
          ひとつ戻る
        </button>
        <h2 className="text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
          今日の答え合わせ
        </h2>
        <button
          type="button"
          onClick={close}
          className="min-h-11 px-1 text-[15px] font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          閉じる
        </button>
      </BottomSheetHeader>

      <div className="flex flex-col gap-4 pt-2 pb-6" style={{ color: 'var(--ink)' }}>
        {items === null ? (
          <p role="status" className="px-1 text-[15px]" style={{ color: 'var(--ink-muted)' }}>
            読み込んでいます
          </p>
        ) : current ? (
          <>
            <p
              className="px-1 text-[13px]"
              style={{ color: 'var(--ink-muted)' }}
              aria-live="polite"
            >
              {position}/{total}件{current.isToday ? '' : '・前の日の片づけ残し'}
            </p>
            <SwipeCard
              key={current.id}
              item={current}
              disabled={busy || picking}
              onConfirm={() => void act('confirm')}
              onCorrect={() => setPicking(true)}
              onIgnore={() => void act('ignore')}
            />
            {current.mergedNote ? (
              <button
                type="button"
                onClick={() => void split()}
                disabled={busy}
                className="min-h-11 self-start px-1 text-[15px] font-semibold disabled:opacity-40"
                style={{ color: 'var(--accent)' }}
              >
                分ける(レシートと支払いの2件にもどす)
              </button>
            ) : null}
            {picking ? (
              <GenrePicker
                currentId={current.genreId}
                onPick={(genreId) => void act('correct', genreId)}
                onCancel={() => setPicking(false)}
                disabled={busy}
              />
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <ActionButton
                  label="直す"
                  hint="← 左"
                  onClick={() => setPicking(true)}
                  disabled={busy}
                />
                <ActionButton
                  label="数えない"
                  hint="↑ 上"
                  onClick={() => void act('ignore')}
                  disabled={busy}
                />
                <ActionButton
                  label="合ってる"
                  hint="右 →"
                  primary
                  onClick={() => void act('confirm')}
                  disabled={busy}
                />
              </div>
            )}
          </>
        ) : finished ? (
          <Finished done={done} summary={summary} onClose={close} />
        ) : (
          <p className="px-1 py-6 text-[15px]" style={{ color: 'var(--ink-muted)' }}>
            確かめる記録はありません。自動で入った記録は、ここで確かめられます。
          </p>
        )}
        {error ? (
          <p role="alert" className="px-1 text-[13px]" style={{ color: 'var(--over)' }}>
            {error}
          </p>
        ) : null}
      </div>
    </BottomSheet>
  );
}

function SwipeCard({
  item,
  disabled,
  onConfirm,
  onCorrect,
  onIgnore,
}: {
  item: TodayCheckItem;
  disabled: boolean;
  onConfirm: () => void;
  onCorrect: () => void;
  onIgnore: () => void;
}) {
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const hint =
    drag.x > SWIPE_PX / 2
      ? '合ってる'
      : drag.x < -SWIPE_PX / 2
        ? '直す'
        : drag.y < -SWIPE_PX / 2
          ? '数えない'
          : null;

  return (
    <article
      aria-label={`${item.storeName} ${formatYen(item.amountYen, { sign: 'never' })}`}
      className="relative flex touch-none flex-col gap-2 rounded-[22px] px-5 py-5 select-none"
      style={{
        background: 'var(--surface)',
        transform: `translate(${drag.x}px, ${Math.min(0, drag.y)}px) rotate(${drag.x / 24}deg)`,
        transition: dragging ? 'none' : 'transform var(--duration-fast) var(--ease-standard)',
      }}
      onPointerDown={(event) => {
        if (disabled) return;
        start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!start.current || start.current.id !== event.pointerId) return;
        setDrag({ x: event.clientX - start.current.x, y: event.clientY - start.current.y });
      }}
      onPointerUp={() => {
        const { x, y } = drag;
        start.current = null;
        setDragging(false);
        setDrag({ x: 0, y: 0 });
        if (x > SWIPE_PX) onConfirm();
        else if (x < -SWIPE_PX) onCorrect();
        else if (y < -SWIPE_PX) onIgnore();
      }}
      onPointerCancel={() => {
        start.current = null;
        setDragging(false);
        setDrag({ x: 0, y: 0 });
      }}
    >
      {hint ? (
        <span
          aria-hidden
          className="absolute top-3 right-4 rounded-full px-3 py-1 text-[13px] font-semibold"
          style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
        >
          {hint}
        </span>
      ) : null}
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[20px] font-semibold">{item.storeName}</span>
        <span className="tabular shrink-0 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          {item.time}
        </span>
      </div>
      {item.detail ? (
        <span className="truncate text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
          {item.detail}
        </span>
      ) : null}
      <span className="tabular text-[34px] leading-tight font-bold">
        {formatYen(item.amountYen, { sign: 'never' })}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-full px-3 py-1 text-[15px] font-semibold"
          style={{
            background: 'var(--plane)',
            border: item.unsure ? '2px solid var(--caution-mark)' : '2px solid transparent',
          }}
        >
          {item.genreName ?? '未分類'}
        </span>
        {item.unsure ? (
          <span className="text-[13px]" style={{ color: 'var(--attention)' }}>
            カテゴリに自信がありません
          </span>
        ) : null}
      </div>
      <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        {item.sourceLabel}から
      </span>
      {item.mergedNote ? (
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {item.mergedNote}
        </p>
      ) : null}
    </article>
  );
}

function ActionButton({
  label,
  hint,
  primary = false,
  onClick,
  disabled,
}: {
  label: string;
  hint: string;
  primary?: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-14 flex-col items-center justify-center rounded-2xl text-[15px] font-semibold disabled:opacity-40"
      style={
        primary
          ? { background: 'var(--action)', color: 'var(--on-action)' }
          : { background: 'var(--surface)', color: 'var(--ink)' }
      }
    >
      {label}
      <span aria-hidden className="text-[11px] font-normal opacity-70">
        {hint}
      </span>
    </button>
  );
}

function GenrePicker({
  currentId,
  onPick,
  onCancel,
  disabled,
}: {
  currentId: string | null;
  onPick: (genreId: string) => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const [genres, setGenres] = useState<{ id: string; name: string }[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetchQuickEntryGenresAction()
      .then((g) => {
        if (alive) setGenres(g);
      })
      .catch(() => {
        if (alive) setGenres([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section aria-label="正しいカテゴリ" className="flex flex-col gap-2">
      <p className="px-1 text-[15px] font-semibold">正しいカテゴリは？</p>
      <p className="px-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        次から、同じお店はこのカテゴリにします。
      </p>
      {genres === null ? (
        <p role="status" className="px-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          読み込んでいます
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {visibleGenres(genres, currentId, all).map((g) => (
            <button
              key={g.id}
              type="button"
              disabled={disabled}
              onClick={() => onPick(g.id)}
              aria-pressed={g.id === currentId}
              className="min-h-11 rounded-xl px-3 py-2 text-left text-[15px] disabled:opacity-40"
              style={{
                background: 'var(--surface)',
                color: 'var(--ink)',
                border: g.id === currentId ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 px-1 text-[15px] font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          キャンセル
        </button>
        {genres && genres.length > 8 && !all ? (
          <button
            type="button"
            onClick={() => setAll(true)}
            className="min-h-11 px-1 text-[15px] font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            すべて
          </button>
        ) : null}
      </div>
    </section>
  );
}

function Finished({
  done,
  summary,
  onClose,
}: {
  done: readonly Done[];
  summary: Summary | null;
  onClose: () => void;
}) {
  const corrected = done.filter((d) => d.action === 'correct').length;
  const ignored = done.filter((d) => d.action === 'ignore').length;
  const yen = (v: number | null) => (v === null ? '—' : formatYen(v, { sign: 'never' }));
  return (
    <section aria-label="答え合わせのまとめ" className="flex flex-col gap-3">
      <p className="px-1 text-[22px] font-bold" role="status">
        おつかれさまでした
      </p>
      <dl
        className="flex flex-col rounded-[22px] px-4 py-2 text-[15px]"
        style={{ background: 'var(--surface)' }}
      >
        <Row label="確かめた" value={`${done.length}件`} />
        <Row
          label="直した"
          value={`${corrected}件${ignored > 0 ? `(数えない ${ignored}件)` : ''}`}
        />
        <Row label="今日の支出" value={summary ? yen(summary.spentTodayYen) : '計算しています'} />
        <Row label="明日からの目安" value={summary ? yen(summary.tomorrowYen) : '計算しています'} />
      </dl>
      <button
        type="button"
        onClick={onClose}
        className="min-h-11 rounded-full py-3 text-[15px] font-semibold"
        style={{ background: 'var(--action)', color: 'var(--on-action)' }}
      >
        閉じる
      </button>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex min-h-11 items-center justify-between gap-3"
      style={{ borderTop: '1px solid var(--hairline)' }}
    >
      <dt style={{ color: 'var(--ink-secondary)' }}>{label}</dt>
      <dd className="tabular font-semibold">{value}</dd>
    </div>
  );
}
