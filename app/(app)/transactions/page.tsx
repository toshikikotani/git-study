import { redirect } from 'next/navigation';

/**
 * 明細一覧は家計簿(/spending)へ統合した(本人発案「明細と家計簿については
 * 統合する。二つのタブの使い分けがわからん」、ADR-057)。実体は
 * `app/(app)/spending/transaction-list-section.tsx`。ここはブックマーク・
 * 共有された旧URL(絞り込みのクエリパラメータ込み)をそのまま /spending へ
 * 引き継ぐためだけに残す。/transactions/import 等のサブ画面は引き続き
 * ここに存在する(統合したのは一覧画面だけ)。
 */
export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') query.set(key, value);
  }
  const queryString = query.toString();
  redirect(queryString ? `/spending?${queryString}` : '/spending');
}
