import type { MetadataRoute } from 'next';

/**
 * PWA(ホーム画面に追加)。ホーム画面のアイコンを長押しすると出るショートカットから、
 * レシート撮影・手入力・話して/文字で記録を直接開ける(`/spending?capture=1` は撮影を開く)。
 * Siri・ショートカットアプリからの起動(N3本人要件)も、ネイティブアプリを持たない
 * ウェブアプリでは作れないため、この仕組み(ホーム画面ショートカット + 後述の
 * /api/widget/today)で代替する——「スクショから記録」は長押しメニュー
 * (app-shell.tsx)からのみ辿れる(ショートカットは主要4件程度が実用上の上限のため)。
 * ウィジェット(ホーム画面・ロック画面)はウェブアプリでは作れないため、代わりに
 * アプリのバッジ(入力待ちの件数)と /api/widget/today(ネイティブのウィジェットや
 * ショートカットアプリから読める要約)を用意した(docs/decisions.md)。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '資産形成',
    short_name: '資産形成',
    description: 'レシートを読み取る家計簿',
    start_url: '/spending',
    display: 'standalone',
    background_color: '#0b0f17',
    theme_color: '#0b0f17',
    lang: 'ja',
    shortcuts: [
      {
        name: 'レシートを撮る',
        short_name: '撮影',
        description: 'カメラを開いてレシートを撮影する',
        url: '/spending?capture=1',
      },
      {
        name: '手入力',
        short_name: '手入力',
        description: 'レシートなしで1件記録する',
        url: '/transactions/new',
      },
      {
        name: '話して記録・文字で記録',
        short_name: '話す/打つ',
        description: '声か文章で取引を記録する',
        url: '/transactions/capture-text',
      },
    ],
  };
}
