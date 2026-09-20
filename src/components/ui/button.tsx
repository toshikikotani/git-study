'use client';

import Link from 'next/link';
import type { Route } from 'next';

import { useRipple } from './ripple';

/**
 * Material 3 の Button(ADR-027)。5種の variant を持つ:
 *
 *   filled     最重要な1アクション。塗り潰し(primary)
 *   tonal      準主役。primary-container の塗り(filled ほど強くない)
 *   outlined   輪郭線のみ。取り消し線的な操作、または filled と並べる第2候補
 *   text       最も控えめ。カード内の付随アクション
 *   elevated   影で浮かせる。サーフェスの上でさらに目立たせたいとき
 *
 * href を渡すと `next/link`、無ければ `<button>` として描画する
 * (レイアウト・見た目は完全に共通)。
 */
type Variant = 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated';

type CommonProps = {
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
  disabled?: boolean;
};

type ButtonAsButton = CommonProps & {
  href?: undefined;
  onClick?: () => void;
  type?: 'button' | 'submit';
};

type ButtonAsLink = CommonProps & {
  href: Route | string;
  onClick?: undefined;
  type?: undefined;
};

const VARIANT_STYLE: Record<Variant, React.CSSProperties> = {
  filled: { background: 'var(--md-primary)', color: 'var(--md-on-primary)' },
  tonal: { background: 'var(--md-primary-container)', color: 'var(--md-on-primary-container)' },
  outlined: {
    background: 'transparent',
    color: 'var(--md-primary)',
    border: '1px solid var(--md-outline)',
  },
  text: { background: 'transparent', color: 'var(--md-primary)' },
  elevated: {
    background: 'var(--md-surface-container-low)',
    color: 'var(--md-primary)',
    boxShadow: 'var(--md-elevation-1)',
  },
};

export function Button(props: ButtonAsButton | ButtonAsLink) {
  const { children, variant = 'filled', className, disabled } = props;
  const { onPointerDown, rippleElements } = useRipple();

  const sharedClassName = `md-label-large relative inline-flex items-center justify-center gap-1.5 overflow-hidden px-6 py-2.5 transition-[box-shadow] ${
    disabled ? 'pointer-events-none opacity-40' : ''
  } ${className ?? ''}`;
  const sharedStyle: React.CSSProperties = {
    borderRadius: 'var(--md-shape-full)',
    transitionDuration: 'var(--md-duration-short)',
    transitionTimingFunction: 'var(--md-easing-standard)',
    ...VARIANT_STYLE[variant],
  };

  if (props.href !== undefined) {
    return (
      <Link
        href={props.href as Route}
        onPointerDown={onPointerDown}
        className={sharedClassName}
        style={sharedStyle}
      >
        {children}
        {rippleElements}
      </Link>
    );
  }

  return (
    <button
      type={props.type ?? 'button'}
      onClick={props.onClick}
      onPointerDown={onPointerDown}
      disabled={disabled}
      className={sharedClassName}
      style={sharedStyle}
    >
      {children}
      {rippleElements}
    </button>
  );
}
