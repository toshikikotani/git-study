/**
 * ボトムナビのカメラ FAB(app/(app)/layout.tsx)で撮った/選んだファイルを、
 * 遷移先の /transactions/receipt(app/(app)/transactions/receipt/page.tsx)
 * へ橋渡しするための一時置き場。
 *
 * ── なぜ必要か ──────────────────────────────────────────────
 * カメラマークを押した瞬間にカメラアプリを開くには、FAB 自身が
 * `<input type="file" capture="environment">` を持つ必要がある(本人発案:
 * 「カメラマーク押した時にすぐカメラアプリになるようにして」)。だが
 * ファイル選択後の抽出・分類・保存処理は /transactions/receipt の
 * 画面ローカル state(useState)に閉じている。File オブジェクトは URL や
 * クエリでは渡せず、React の props は別ルートのコンポーネント間を跨げない
 * ため、両者がインポートできる単純なモジュール変数で橋渡しする
 * (App Router の同一レイアウト内の遷移は SPA なので、この JS モジュールの
 * 状態はそのまま保たれる)。
 */
let pendingFiles: File[] | null = null;

export function setPendingReceiptFiles(files: readonly File[]): void {
  pendingFiles = [...files];
}

/** 1度取り出したら消える(直接 URL を開いた場合などは常に null)。 */
export function takePendingReceiptFiles(): File[] | null {
  const files = pendingFiles;
  pendingFiles = null;
  return files;
}
