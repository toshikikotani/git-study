'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { useIsClient } from './use-is-client';

/**
 * 下から出る Liquid Glass シート(ADR-028)の共通の枠(本人発案「いろんな
 * ところを参考にしながら直感的な操作を実現したい。操作を重複させることが
 * 大事」)。`more-menu.tsx` が最初に持っていたシートの見た目(背景の
 * フェード+「行き過ぎてから収まる」スライド、外側タップで閉じる)を、
 * 明細行の長押しプレビュー(split-editor.tsx)でも同じものとして使うため
 * ここへ切り出した(3箇所目が増える前に、2箇所目の時点で共通化)。
 *
 * 閉じているあいだは何も描かない(開くときに描き、閉じる動きが終わったら外す)。
 * 以前は閉じていても常に描いており、明細の行ごとに4枚のシート(背景をぼかす
 * `backdrop-filter` つき)が載って、明細が数百件になると iPhone の描画メモリを
 * 使い切ってページごと落ちた。閉じる動きは、外す前に最後まで再生する。
 * `document.body` へ Portal する理由・
 * `useIsClient` の必要性も同じ(祖先の backdrop-filter が position:fixed の
 * 基準になる不具合の回避)。
 */
export function BottomSheet({
  open,
  onClose,
  /** シート本体の role(例:"menu"・"dialog")。呼び出し側の意味づけに合わせる。 */
  role,
  children,
}: {
  open: boolean;
  onClose: () => void;
  role?: string;
  children: React.ReactNode;
}) {
  const isClient = useIsClient();
  const { mounted, shown } = useSheetPresence(open, SHEET_EXIT_MS);
  if (!isClient || !mounted) return null;

  return createPortal(
    <>
      {/* 背景。フェードのみ、動きは付けない(方向感が要らない)。ここをタップすると閉じる */}
      <div
        aria-hidden={!shown}
        onClick={onClose}
        className="fixed inset-0 z-40 transition-opacity duration-200 ease-out motion-reduce:transition-none"
        style={{
          background: 'rgba(10, 16, 32, 0.45)',
          opacity: shown ? 1 : 0,
          pointerEvents: shown ? 'auto' : 'none',
        }}
      />

      <div
        role={role}
        aria-hidden={!shown}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-2xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-transform will-change-transform motion-reduce:transition-none"
        style={{
          transform: shown ? 'translateY(0)' : 'translateY(110%)',
          transitionDuration: 'var(--duration-slow)',
          transitionTimingFunction: 'var(--ease-sheet)',
          pointerEvents: shown ? 'auto' : 'none',
        }}
      >
        <div
          className="max-h-[75dvh] overflow-y-auto p-2"
          style={{
            borderRadius: 'var(--radius-card)',
            background: 'var(--glass-tint-strong)',
            backdropFilter: 'var(--glass-blur-strong)',
            WebkitBackdropFilter: 'var(--glass-blur-strong)',
            border: '1px solid var(--glass-border)',
            boxShadow: 'var(--glass-shadow-float)',
          }}
        >
          <div className="flex justify-center pt-2 pb-1">
            <span className="h-2 w-10 rounded-full" style={{ background: 'var(--hairline)' }} />
          </div>
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}

/** 閉じる動き(`--duration-slow`)より少し長く待ってから外す。 */
export const SHEET_EXIT_MS = 500;

/**
 * シートを描く期間の管理。
 *   mounted: 描くか(開いたときから、閉じる動きが終わるまで)
 *   shown  : 開いた見た目か(描いた直後は閉じた位置から始め、次のフレームで開く=スライドが動く)
 */
export function useSheetPresence(
  open: boolean,
  exitMs: number,
): { mounted: boolean; shown: boolean } {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);
  // 開くときは、その描画のうちに描き始める(1フレーム遅れて出ない)。
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open) {
      let inner = 0;
      const outer = window.requestAnimationFrame(() => {
        inner = window.requestAnimationFrame(() => setEntered(true));
      });
      return () => {
        window.cancelAnimationFrame(outer);
        window.cancelAnimationFrame(inner);
      };
    }
    const t = window.setTimeout(() => {
      setMounted(false);
      setEntered(false);
    }, exitMs);
    return () => window.clearTimeout(t);
  }, [open, exitMs]);

  return { mounted, shown: open && entered };
}
