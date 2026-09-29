import { parseDateOnlyOr, todayJst } from '@/lib/date';
import { NewTransactionForm } from './new-transaction-form';

/**
 * 明細を手で登録する。`?date=YYYY-MM-DD` があれば、その日を日付の初期値にする
 * (家計簿のカレンダーの日付メニューから開く、本人発案)。形式が正しくない値は
 * 無視して今日にする。
 */
export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[]; type?: string | string[] }>;
}) {
  const { date, type } = await searchParams;
  return (
    <NewTransactionForm
      initialDate={parseDateOnlyOr(date, todayJst())}
      initialIncome={type === 'income'}
    />
  );
}
