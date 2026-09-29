import type { MetadataRoute } from 'next';

/**
 * PWA(ホーム画面に追加)。ホーム画面のアイコンを長押しすると出るショートカットから、
 * レシート撮影・手入力を直接開ける(`/spending?capture=1` は撮影を開く)。
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
    ],
  };
}
