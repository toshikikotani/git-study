import * as React from 'react';

/**
 * 画面遷移をまたいで同じ要素として動く「共有要素」(React の ViewTransition)。
 * 家計簿のジャンル行のアイコン・名前・金額が、カテゴリ詳細のヘッダーへそのまま移動・拡大し、
 * 戻るときは逆の動きで戻る。同じ name を遷移前後の2か所につける。
 *
 * ViewTransition は React の canary にだけあり(Next の App Router が使う)、素の React
 * (テスト・古い環境)には無いため、無ければ何もせず子をそのまま出す。
 * 「視差効果を減らす」ときは、globals.css がモーフをクロスフェードに置き換える。
 */
type VT = React.ComponentType<{
  name?: string;
  share?: string;
  default?: string;
  children: React.ReactNode;
}>;

/**
 * iOS の WebKit(Safari・アプリ内ブラウザ・iOS 上の全ブラウザ)では、名前付きの要素が多い画面
 * (家計簿のジャンル行)で View Transitions が描画プロセスを落とすことがあった。iOS では
 * 共有要素を使わず、通常の画面遷移(クロスフェード)にする。
 */
export function isIOSWebKit(ua: string, maxTouchPoints = 0): boolean {
  return /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

const ViewTransition =
  typeof navigator !== 'undefined' && isIOSWebKit(navigator.userAgent, navigator.maxTouchPoints)
    ? undefined
    : (React as unknown as { ViewTransition?: VT }).ViewTransition;

export function SharedElement({ name, children }: { name: string; children: React.ReactNode }) {
  if (!ViewTransition) return <>{children}</>;
  return (
    <ViewTransition name={name} share="morph" default="none">
      {children}
    </ViewTransition>
  );
}

/** 共有要素の名前(行 → ヘッダーで同じ名前を使う)。 */
export const sharedName = {
  icon: (genreKey: string) => `category-icon-${genreKey}`,
  title: (genreKey: string) => `category-title-${genreKey}`,
  amount: (genreKey: string) => `category-amount-${genreKey}`,
};
