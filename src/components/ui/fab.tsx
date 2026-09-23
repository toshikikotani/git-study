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
 * href を渡すと通常のリンク、onFiles を渡すと `<input type="file">` を
 * 持つ `<label>` になる。
 *
 * ── 撮る/選ぶを選択できるようにする(本人発案) ──────────────
 * 以前は `capture="environment"` を付け、タップした瞬間に OS のカメラを
 * 直接開いていた(画面遷移を挟まない即時性を優先)。その後「カメラアイコン
 * 押した時に写真を撮るか選ぶか選択できるようにして」と方針が変わったため、
 * `capture` を外した——`<input type="file" accept="image/*">` は
 * `capture` が無いと、モバイルの OS がその場で「写真を撮る/ライブラリから
 * 選ぶ」のネイティブな選択肢を出す(`/transactions/receipt` の「撮る」
 * 「選ぶ」2ボタンを、この1つのアイコンに集約した形)。
 *
 * `<label><input type="file">` はネイティブ要素のため、React が
 * ハイドレーションを終える前でもタップして機能する(本人からの不具合
 * 報告「起動が遅い」への対応、app/(app)/layout.tsx 参照)。
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
