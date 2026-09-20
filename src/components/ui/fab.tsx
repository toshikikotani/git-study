'use client';

import Link from 'next/link';
import type { Route } from 'next';

/**
 * 主要な1アクション用の丸ボタン(ADR-028、ADR-027の Material FAB を置き換え)。
 *
 * 56×56、accent の塗り+アクセント色を帯びた影。Apple のアプリでも
 * 「作成・撮影」系の主要アクションは Liquid Glass ではなく塗り潰しの円
 * (Mail の作成ボタン、Phone の発信ボタン等)であることに倣い、ガラス素材
 * にはしない——ここでは「一番押してほしいボタン」であることを最優先する。
 * このアプリではレシート撮影に使う(app/(app)/layout.tsx)。
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
  return (
    <Link
      href={href as Route}
      aria-label={label}
      className="active:scale-[0.92] flex size-14 shrink-0 items-center justify-center"
      style={{
        borderRadius: 'var(--radius-full)',
        background: 'var(--accent)',
        color: 'var(--on-accent)',
        boxShadow: `0 10px 24px color-mix(in srgb, var(--accent) 35%, transparent), var(--shadow-1)`,
        transition: 'transform var(--duration-medium) var(--ease-spring)',
      }}
    >
      {children}
    </Link>
  );
}
