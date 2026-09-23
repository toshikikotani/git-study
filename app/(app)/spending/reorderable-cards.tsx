'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MdDragIndicator } from 'react-icons/md';

import { useIsClient } from '@/components/ui/use-is-client';

const STORAGE_KEY = 'spending-card-order';
const LONG_PRESS_MS = 350;
const MOVE_SLOP = 10;

export type SpendingCardKey =
  'summary' | 'calendar' | 'forecast' | 'diagnosis' | 'categoryBreakdown' | 'pile';

/**
 * 家計簿(/spending)の各カードの並び順を、本人が自由に変えられるように
 * する(本人発案、ADR-046:「そこの部分自由にレイアウト変えれるように
 * したい」)。これまで並び替えのたびに本人からの手書き注釈付き指摘→
 * コード変更という往復(ADR-043/044)が続いていたため、本人が直接
 * 操作できるようにした。
 *
 * ── なぜ並び替えを明示的な「編集」モードの中だけにしたのか ─────────
 * 各カード(`CategoryBreakdownChart`・`DiagnosisCard`・`SpendingCalendar`)
 * はそれ自体が押せる要素を大量に持つ(開閉・保存ボタン等)。カード本体の
 * どこを長押ししてもドラッグが始まることにすると、普段の操作(カテゴリ行を
 * 開く等)と衝突する。そのため「並び替え」ボタンを押した時だけ、各カードの
 * 右上に専用のつまみ(`MdDragIndicator`)を出し、そこだけを長押し+ドラッグの
 * 起点にした(本人が選んだ操作、AskUserQuestionで確認)。編集モードでない
 * 間は、これまでどおり何も変わらない。
 *
 * ── 保存先はブラウザの localStorage(サーバーには保存しない) ──────
 * `app_settings`(ADR-014)は本人の入力に基づく「業務パラメータ」の置き場で、
 * どの画面の見た目をどう並べるかという表示上の好みとは性質が違う
 * (`src/features/settings/store.ts` 参照)。このアプリはこれまで本人の
 * 1台の端末(スマホ)でしか使われておらず、新しいテーブル・RLS・移行
 * スクリプトを増やすほどの持続性は不要と判断した。失っても「もう一度
 * 並べ替えるだけ」で被害が無い(お金の記録のような失うと困るデータではない)。
 *
 * ── 並べ替えのアルゴリズム(「場所を空けてから、指を離した時だけ確定」)──
 * ドラッグ中は実際の並び順(`order` state)を変えない。ドラッグ開始時に
 * 各カードの位置・高さを1回だけキャプチャし、指の絶対Y座標がどのカードの
 * 中間点を過ぎたかで「今離したらどこに入るか」(targetIndex)だけを計算する。
 * 見た目は、ドラッグ中のカードが指にそのまま追従し、間に挟まる他のカードは
 * ドラッグ中のカードの高さぶんだけ transform で「場所を空ける」。指を離した
 * 瞬間に初めて `order` を実際に組み替えて保存する。ドラッグの最中に配列を
 * 組み替えてから transform を計算するより、位置の再計算・ズレが起きない
 * (ADR-042 の `SwipeableRow`・`pull-to-refresh.tsx` と同じ、ref に生の値、
 * state に再描画用の値を持つ流儀)。
 *
 * ── 既知の制約 ─────────────────────────────────────────────
 * タッチ操作専用(マウスでのドラッグは対象外——このアプリ自体がスマホ
 * 専用の個人用アプリのため)。画面の上下端付近でのオートスクロールは
 * 実装していない(カードは6枚のみで、多くの端末で1〜2画面に収まるため、
 * 現時点では見送った)。
 */
export function ReorderableCards({
  cards,
  defaultOrder,
}: {
  cards: Record<SpendingCardKey, ReactNode>;
  defaultOrder: readonly SpendingCardKey[];
}) {
  const isClient = useIsClient();
  const [order, setOrder] = useState<SpendingCardKey[]>(() => [...defaultOrder]);
  const [editing, setEditing] = useState(false);
  // localStorage は client でしか読めない。isClient が true になった直後
  // (ハイドレーション完了直後)に1回だけ、保存済みの並び順があれば
  // 上書きする——useEffect ではなくレンダー中の比較で行う
  // (react-hooks/set-state-in-effect、more-menu.tsx と同じ理由。
  // useEffect + setState は実質「マウント後に強制で1回再レンダーする」
  // ためだけの物で、カスケードするレンダーを避けたい)。
  const [appliedStoredOrder, setAppliedStoredOrder] = useState(false);
  if (isClient && !appliedStoredOrder) {
    setAppliedStoredOrder(true);
    const stored = readStoredOrder(defaultOrder);
    if (stored) setOrder(stored);
  }

  function commitOrder(next: SpendingCardKey[]): void {
    setOrder(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 保存できなくても表示上の並び順は変わるので、機能自体は失われない。
    }
  }

  return (
    <div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="text-[13px] font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          {editing ? '完了' : '並び替え'}
        </button>
      </div>

      <DragList order={order} cards={cards} editing={editing} onCommit={commitOrder} />
    </div>
  );
}

/** 保存済みの並び順を読む。無い・壊れている・読めない場合は null。 */
function readStoredOrder(defaultOrder: readonly SpendingCardKey[]): SpendingCardKey[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved: unknown = JSON.parse(raw);
    if (!Array.isArray(saved)) return null;
    const validKeys = new Set<string>(defaultOrder);
    const restored = saved.filter(
      (k): k is SpendingCardKey => typeof k === 'string' && validKeys.has(k),
    );
    if (restored.length === 0) return null;
    // 新しく増えたカード(保存済みの並び順に無いもの)は末尾に足す。
    const missing = defaultOrder.filter((k) => !restored.includes(k));
    return [...restored, ...missing];
  } catch {
    // 壊れた値・プライベートモード等で読めない場合は既定順のまま。
    return null;
  }
}

type Slot = { top: number; height: number };

function DragList({
  order,
  cards,
  editing,
  onCommit,
}: {
  order: SpendingCardKey[];
  cards: Record<SpendingCardKey, ReactNode>;
  editing: boolean;
  onCommit: (next: SpendingCardKey[]) => void;
}) {
  const itemRefs = useRef<Record<SpendingCardKey, HTMLDivElement | null>>({
    summary: null,
    calendar: null,
    forecast: null,
    diagnosis: null,
    categoryBreakdown: null,
    pile: null,
  });
  const [draggingKey, setDraggingKey] = useState<SpendingCardKey | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);
  // ドラッグ中のカードの高さ。他のカードが「場所を空ける」量として
  // レンダーで使うため、ref ではなく state に持つ(react-hooks/refs、
  // レンダー中に ref.current を読まない)。
  const [draggedHeight, setDraggedHeight] = useState(0);
  const startYRef = useRef(0);
  const slotsRef = useRef<Slot[]>([]);
  const targetIndexRef = useRef<number | null>(null);

  function handleLongPressStart(key: SpendingCardKey, clientY: number): void {
    // ドラッグ開始時点の各カードの位置・高さを1回だけキャプチャする
    // (このドラッグ中は `order` 自体を変えないため、ページがスクロール
    // さえしなければ最後まで有効——ドラッグ中は touchmove 側で
    // preventDefault しており、ページのスクロールは起きない)。
    const slots = order.map((k) => {
      const rect = itemRefs.current[k]?.getBoundingClientRect();
      return { top: rect?.top ?? 0, height: rect?.height ?? 0 };
    });
    slotsRef.current = slots;
    setDraggingKey(key);
    startYRef.current = clientY;
    setDragOffset(0);
    const startIndex = order.indexOf(key);
    setTargetIndex(startIndex);
    targetIndexRef.current = startIndex;
    setDraggedHeight(slots[startIndex]?.height ?? 0);
  }

  function handleDragMove(clientY: number): void {
    setDragOffset(clientY - startYRef.current);

    const slots = slotsRef.current;
    let next = slots.length - 1;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot && clientY < slot.top + slot.height / 2) {
        next = i;
        break;
      }
    }
    targetIndexRef.current = next;
    setTargetIndex(next);
  }

  function handleDragEnd(key: SpendingCardKey): void {
    const finalTargetIndex = targetIndexRef.current;
    setDraggingKey(null);
    setDragOffset(0);
    setTargetIndex(null);
    targetIndexRef.current = null;

    const originalIndex = order.indexOf(key);
    if (finalTargetIndex === null || finalTargetIndex === originalIndex) return;
    const next = [...order];
    next.splice(originalIndex, 1);
    next.splice(finalTargetIndex, 0, key);
    onCommit(next);
  }

  const originalIndex = draggingKey ? order.indexOf(draggingKey) : -1;

  return (
    <div className="mt-2 space-y-3">
      {order.map((key, index) => {
        const isDragging = key === draggingKey;
        const displacement =
          !isDragging && draggingKey && targetIndex !== null
            ? displacementFor(index, originalIndex, targetIndex, draggedHeight)
            : 0;

        return (
          <div
            key={key}
            ref={(el) => {
              itemRefs.current[key] = el;
            }}
            className="relative"
            style={{
              transform: isDragging
                ? `translateY(${dragOffset}px)`
                : displacement !== 0
                  ? `translateY(${displacement}px)`
                  : undefined,
              transition: isDragging
                ? 'none'
                : 'transform var(--duration-medium) var(--ease-spring)',
              zIndex: isDragging ? 10 : undefined,
            }}
          >
            {cards[key]}
            {editing ? (
              <DragHandle
                onLongPressStart={(y) => handleLongPressStart(key, y)}
                onDragMove={handleDragMove}
                onDragEnd={() => handleDragEnd(key)}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * ドラッグ中のカードが `originalIndex` から `targetIndex` へ移動したとき、
 * `itemIndex` にある(ドラッグ対象ではない)カードがどれだけ動いて場所を
 * 空けるべきか。ドラッグ中のカードの高さぶんだけ、間に挟まるカードを
 * 押しのける(下へ移動なら間のカードは上へ、上へ移動なら間のカードは下へ)。
 */
function displacementFor(
  itemIndex: number,
  originalIndex: number,
  targetIndex: number,
  draggedHeight: number,
): number {
  if (originalIndex === targetIndex) return 0;
  if (targetIndex > originalIndex) {
    if (itemIndex > originalIndex && itemIndex <= targetIndex) return -draggedHeight;
    return 0;
  }
  if (itemIndex >= targetIndex && itemIndex < originalIndex) return draggedHeight;
  return 0;
}

/**
 * つまみ1つ分。長押し(`LONG_PRESS_MS`)でドラッグ開始、動きすぎたら
 * (`MOVE_SLOP`)開始前にキャンセルする(`swipeable-row.tsx` と同じ判定の
 * 考え方)。`pull-to-refresh.tsx` と同じ理由で、`preventDefault()` が効く
 * ネイティブの `addEventListener({ passive: false })` を使う。
 */
function DragHandle({
  onLongPressStart,
  onDragMove,
  onDragEnd,
}: {
  onLongPressStart: (clientY: number) => void;
  onDragMove: (clientY: number) => void;
  onDragEnd: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let dragging = false;
    let start: { x: number; y: number } | null = null;

    const clearTimer = () => {
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      start = { x: touch.clientX, y: touch.clientY };
      dragging = false;
      longPressTimer = setTimeout(() => {
        dragging = true;
        onLongPressStart(touch.clientY);
      }, LONG_PRESS_MS);
    };

    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch || !start) return;
      if (!dragging) {
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dx) > MOVE_SLOP || Math.abs(dy) > MOVE_SLOP) clearTimer();
        return;
      }
      e.preventDefault();
      onDragMove(touch.clientY);
    };

    const onTouchEnd = () => {
      clearTimer();
      if (dragging) onDragEnd();
      dragging = false;
      start = null;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      clearTimer();
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [onLongPressStart, onDragMove, onDragEnd]);

  return (
    <button
      ref={ref}
      type="button"
      aria-label="つまんで並び替え"
      className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full"
      style={{
        background: 'var(--glass-tint-strong)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        color: 'var(--ink-muted)',
        touchAction: 'none',
      }}
    >
      <MdDragIndicator aria-hidden size={18} />
    </button>
  );
}
