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
 *
 * ── なぜ購読(subscribe)も要るのか(本人からの不具合報告:「画像渡して
 *    何の反応も無い」)──────────────────────────────────────────
 * ADR-029(next.config.ts の staleTimes.dynamic を24時間に延長)により、
 * 一度開いた画面は Router Cache に残ったまま再利用される。/transactions/
 * receipt を一度開いた後、他の画面から再度カメラ FAB を押すと、遷移先の
 * ページはマウントし直されず「前回と同じコンポーネントインスタンス」が
 * 再利用される。取り込み側が `useEffect(() => {...}, [])` でマウント時
 * 一度だけ `takePendingReceiptFiles()` を呼ぶ実装だと、この2回目以降は
 * effect 自体が再実行されず、せっかく置いたファイルを誰も取りに来ない
 * ——「渡したのに何も起きない」という報告はこれが原因だった。
 * `setPendingReceiptFiles()` の呼び出しをその場で購読者に知らせることで、
 * 画面がマウントし直されていなくても新しいファイルを拾える。
 */
type Listener = () => void;

let pendingFiles: File[] | null = null;
const listeners = new Set<Listener>();

export function setPendingReceiptFiles(files: readonly File[]): void {
  pendingFiles = [...files];
  for (const listener of listeners) listener();
}

/** 1度取り出したら消える(直接 URL を開いた場合などは常に null)。 */
export function takePendingReceiptFiles(): File[] | null {
  const files = pendingFiles;
  pendingFiles = null;
  return files;
}

/**
 * `setPendingReceiptFiles()` が呼ばれるたびに通知を受ける。画面が
 * マウントされたまま(Router Cache 再利用)でも新しいファイルに気づける
 * ようにするための購読口。戻り値の関数で解除する。
 */
export function subscribePendingReceiptFiles(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
