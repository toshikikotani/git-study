'use client';

import Link from 'next/link';
import type { Route } from 'next';

import { useRipple } from './ripple';

/**
 * Material 3 の Floating Action Button(ADR-027)。
 *
 * 56×56dp、primary-container の塗り + elevation 3。画面の最重要な
 * 1アクションに使う(このアプリではレシート撮影、app/(app)/layout.tsx)。
 */
export function Fab({
  href,
  label,
  children,
}: {
  href: Route | string;
  /** スクリーンリーダー向け。アイコンだけで文字を出さないため必須。 */
  label: string;
  children: React.ReactNode;
}) {
  const { onPointerDown, rippleElements } = useRipple();

  return (
    <Link
      href={href as Route}
      aria-label={label}
      onPointerDown={onPointerDown}
      className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden"
      style={{
        borderRadius: 'var(--md-shape-lg)',
        background: 'var(--md-primary-container)',
        color: 'var(--md-on-primary-container)',
        boxShadow: 'var(--md-elevation-3)',
      }}
    >
      {children}
      {rippleElements}
    </Link>
  );
}
