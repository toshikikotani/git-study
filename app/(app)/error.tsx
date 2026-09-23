'use client';

import { useEffect } from 'react';
import { MdErrorOutline } from 'react-icons/md';

import { Button } from '@/components/ui/button';

/**
 * (app) 配下のエラーバウンダリ(本人からの不具合報告「これよく出てくる」、
 * ホームを開いた直後に出る Vercel のプラットフォーム側汎用クラッシュ画面
 * のスクリーンショット付き)。
 *
 * ── これが無かったこと自体が原因 ────────────────────────────
 * このアプリには error.tsx が1つも無かった。ホーム(`/`)は
 * `loadHomeSummary()`・`getCheckinStreak()`・`loadCategoryMonthDetail()`
 * など複数の Supabase 呼び出しを await しており、どれか1つが一時的な
 * 接続断・タイムアウトで失敗すると、Next.js の Error Boundary が
 * どこにも無いため例外がそのまま Vercel のプラットフォーム層まで
 * 突き抜け、アプリの見た目と無関係な汎用エラー画面(本人が撮った
 * スクリーンショットのもの)が出ていた。根本の一時的な接続断自体は
 * 呼び出し元ごとに個別対応が要るため、まずはこの Error Boundary を
 * 置いて「アプリらしい見た目でその場からやり直せる」ようにする。
 *
 * ── (app)/layout.tsx の直下に置いた理由 ───────────────────────
 * ルートグループの error.tsx は同じセグメントの page.tsx とその子孫の
 * 例外だけを差し替え、親の layout.tsx(ボトムナビ)はそのまま描画され
 * 続ける(Next.js の仕様)。ホームを含む主要4タブすべてがこの
 * グループ配下にあるため、ここに1つ置くだけで全タブをカバーできる。
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <MdErrorOutline aria-hidden size={40} style={{ color: 'var(--over)' }} />
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          読み込めませんでした
        </p>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          通信が不安定なだけかもしれません。もう一度お試しください。
        </p>
      </div>
      <Button onClick={reset} variant="filled" className="mt-1">
        もう一度試す
      </Button>
    </div>
  );
}
