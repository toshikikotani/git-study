/**
 * loading.tsx が一瞬で切り替わってしまう不具合への対応(本人報告
 * 「読み込み中に画面全体にローディング表示されない」)。
 *
 * ── 何が起きていたか ────────────────────────────────────────
 * ADR-029 の pull-to-refresh 実装後、初めて開く画面でもローディングの
 * スケルトンが一切見えず、いきなり新しい画面に切り替わるという報告が
 * あった。`prefetch={false}` を試したが直らなかったため、実際に
 * 最小構成の再現環境(遅延なしのダミーページ+loading.tsx)を作って
 * Playwright で検証したところ、Next.js の仕組み自体は正しく動作して
 * いた(初回は loading.tsx→本体、revisit はキャッシュからそのまま)。
 * 本番の Vercel + Supabase は往復が数十〜百数十ms程度と速く、
 * loading.tsx のスケルトンが描画されてから本体に置き換わるまでが
 * 一瞬すぎて、本人の目には「ローディングが出ていない」ように見えて
 * いたと判断した(実際には画面は正しく切り替わっている、との報告と整合)。
 *
 * ── 対応方針 ────────────────────────────────────────────────
 * データ取得そのものを遅くするのではなく、「取得が最低でも
 * MIN_LOADING_MS だけはかかったことにする」形で、loading.tsx が
 * 目に見える時間だけ表示され続けるようにする。pull-to-refresh で
 * 一度読み込んだ画面を再訪したとき(ADR-029、staleTimes によりキャッシュ
 * から即表示される経路)はこの関数を経由しない——page.tsx 自体が
 * 再実行されないため、この遅延も発生しない。
 */
const MIN_LOADING_MS = 400;

export async function withMinDuration<T>(
  work: Promise<T>,
  minMs: number = MIN_LOADING_MS,
): Promise<T> {
  const started = Date.now();
  const result = await work;
  const remaining = minMs - (Date.now() - started);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  return result;
}
