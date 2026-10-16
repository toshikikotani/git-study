import { redirect } from 'next/navigation';

/**
 * 旧「手入力」の画面。手で記録するのは「記録する」(＋)のシートだけにした(ADR-096)ので、明細へ移って
 * シートを開く。`?date=YYYY-MM-DD`(その日を日付に)と `?type=income`(収入から)は引き継ぐ。
 */
export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[]; type?: string | string[] }>;
}) {
  const { date, type } = await searchParams;
  const params = new URLSearchParams({ record: '1' });
  if (typeof date === 'string') params.set('date', date);
  if (type === 'income') params.set('type', 'income');
  redirect(`/spending?${params.toString()}`);
}
