'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useIsClient } from '@/components/ui/use-is-client';
import { SHEET_HEIGHT_DVH, keyboardInset, nextSheetState, type SheetState } from '@/lib/sheet';

/**
 * 半分の高さで開き、ハンドルを上へスワイプすると全画面になるシート(編集シート用)。
 * 下へ大きくスワイプすると閉じる。ソフトウェアキーボードが出たら、その高さぶん下に余白を足し、
 * フォーカスした入力欄がキーボードに隠れないよう中央へスクロールする。
 * 動きはスプリング(「視差効果を減らす」のときは高さを動かさず切り替える)。
 */
export function ExpandableSheet({
  open,
  state,
  onState,
  onClose,
  label,
  children,
}: {
  open: boolean;
  state: Exclude<SheetState, 'closed'>;
  onState: (state: Exclude<SheetState, 'closed'>) => void;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const isClient = useIsClient();
  const [drag, setDrag] = useState<number | null>(null);
  const [inset, setInset] = useState(0);
  const start = useRef<{ y: number; t: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // キーボードの高さ(visualViewport)。
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () =>
      setInset(
        keyboardInset({
          innerHeight: window.innerHeight,
          visualHeight: vv.height,
          visualOffsetTop: vv.offsetTop,
        }),
      );
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [open]);

  // Esc で閉じる。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!isClient) return null;

  const height = SHEET_HEIGHT_DVH[state];
  return createPortal(
    <>
      <div
        aria-hidden={!open}
        onClick={onClose}
        className="fixed inset-0 z-40"
        style={{
          background: 'rgba(10, 16, 32, 0.45)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity var(--motion-small) var(--motion-ease-out)',
        }}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-hidden={!open}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-2xl flex-col overflow-hidden"
        style={{
          height: `${height}dvh`,
          maxHeight: `calc(100dvh - ${inset}px)`,
          borderRadius: 'var(--radius-card) var(--radius-card) 0 0',
          background: 'var(--surface)',
          boxShadow: 'var(--glass-shadow-float)',
          transform: open ? `translateY(${drag ?? 0}px)` : 'translateY(110%)',
          transition:
            drag === null
              ? 'transform var(--motion-spring-duration) var(--motion-spring), height var(--motion-spring-duration) var(--motion-spring)'
              : 'none',
          pointerEvents: open ? 'auto' : 'none',
          paddingBottom: inset,
        }}
      >
        <div
          className="flex min-h-11 shrink-0 cursor-grab touch-none items-center justify-center"
          role="separator"
          aria-label="上へスワイプで全画面、下へスワイプで閉じる"
          onPointerDown={(e) => {
            start.current = { y: e.clientY, t: performance.now() };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (start.current)
              setDrag(Math.max(e.clientY - start.current.y, state === 'full' ? -0 : -0));
          }}
          onPointerUp={(e) => {
            const s = start.current;
            start.current = null;
            setDrag(null);
            if (!s) return;
            const dy = e.clientY - s.y;
            const dt = Math.max(performance.now() - s.t, 1);
            const next = nextSheetState(state, dy, dy / dt);
            if (next === 'closed') onClose();
            else onState(next);
          }}
          onPointerCancel={() => {
            start.current = null;
            setDrag(null);
          }}
        >
          <span className="h-1 w-10 rounded-full" style={{ background: 'var(--hairline)' }} />
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6"
          onFocusCapture={(e) => {
            const el = e.target as HTMLElement;
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
              window.setTimeout(
                () => el.scrollIntoView({ block: 'center', behavior: 'smooth' }),
                250,
              );
            }
          }}
        >
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}
