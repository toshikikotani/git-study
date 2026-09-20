'use client';

import Link from 'next/link';
import type { Route } from 'next';

/**
 * Apple 風のボタン(ADR-028、ADR-027の Material Button を置き換え)。5種の variant を持つ:
 *
 *   filled     最重要な1アクション。塗り潰し(accent)
 *   tonal      準主役。accent-track の塗り(filled ほど強くない)
 *   outlined   輪郭線のみ。取り消し線的な操作、または filled と並べる第2候補
 *   text       最も控えめ。カード内の付随アクション
 *   elevated   カードやヒーローの上に浮かせるボタン。Liquid Glass 素材を使う
 *              唯一の variant(HIG が chrome にだけガラスを使う方針に倣う、
 *              app/globals.css の ADR-028 コメント参照)
 *
 * href を渡すと `next/link`、無ければ `<button>` として描画する
 * (レイアウト・見た目は完全に共通)。押下フィードバックは Material の
 * リップルではなく、Apple 的な「軽く縮んでバネで戻る」スケールにした。
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
  filled: { background: 'var(--accent)', color: 'var(--on-accent)' },
  tonal: { background: 'var(--accent-track)', color: 'var(--accent)' },
  outlined: {
    background: 'transparent',
    color: 'var(--accent)',
    border: '1px solid var(--hairline)',
  },
  text: { background: 'transparent', color: 'var(--accent)' },
  elevated: {
    background: 'var(--glass-tint)',
    backdropFilter: 'var(--glass-blur)',
    WebkitBackdropFilter: 'var(--glass-blur)',
    color: 'var(--accent)',
    border: '1px solid var(--glass-border)',
    boxShadow: 'var(--glass-shadow)',
  },
};

export function Button(props: ButtonAsButton | ButtonAsLink) {
  const { children, variant = 'filled', className, disabled } = props;

  const sharedClassName = `label-text active:scale-[0.96] inline-flex items-center justify-center gap-1.5 px-6 py-2.5 ${
    disabled ? 'pointer-events-none opacity-40' : ''
  } ${className ?? ''}`;
  const sharedStyle: React.CSSProperties = {
    borderRadius: 'var(--radius-full)',
    transition: `transform var(--duration-medium) var(--ease-spring), background-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)`,
    ...VARIANT_STYLE[variant],
  };

  if (props.href !== undefined) {
    return (
      <Link href={props.href as Route} className={sharedClassName} style={sharedStyle}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type={props.type ?? 'button'}
      onClick={props.onClick}
      disabled={disabled}
      className={sharedClassName}
      style={sharedStyle}
    >
      {children}
    </button>
  );
}
