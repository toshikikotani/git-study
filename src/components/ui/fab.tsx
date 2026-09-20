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
 *
 * href を渡すと通常のリンク、onFiles を渡すとカメラ起動用の
 * `<input type="file" capture="environment">` を持つ `<label>` になる
 * (本人発案:「カメラマーク押した時にすぐカメラアプリになるようにして」——
 * 画面遷移を挟まず、タップした瞬間に OS のカメラが開く)。
 */
type CommonProps = {
  /** スクリーンリーダー向け。アイコンだけで文字を出さないため必須。 */
  label: string;
  children: React.ReactNode;
};

type FabAsLink = CommonProps & {
  href: Route | string;
  onFiles?: undefined;
};

type FabAsCapture = CommonProps & {
  href?: undefined;
  onFiles: (files: readonly File[]) => void;
};

const SHARED_STYLE: React.CSSProperties = {
  borderRadius: 'var(--radius-full)',
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  boxShadow: `0 10px 24px color-mix(in srgb, var(--accent) 35%, transparent), var(--shadow-1)`,
  transition: 'transform var(--duration-medium) var(--ease-spring)',
};

export function Fab(props: FabAsLink | FabAsCapture) {
  const { label, children } = props;

  if (props.href !== undefined) {
    return (
      <Link
        href={props.href as Route}
        aria-label={label}
        className="active:scale-[0.92] flex size-14 shrink-0 items-center justify-center"
        style={SHARED_STYLE}
      >
        {children}
      </Link>
    );
  }

  return (
    <label
      aria-label={label}
      className="active:scale-[0.92] flex size-14 shrink-0 cursor-pointer items-center justify-center"
      style={SHARED_STYLE}
    >
      <input
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) props.onFiles(files);
          e.target.value = '';
        }}
      />
      {children}
    </label>
  );
}
