import { redirect } from 'next/navigation';

/** 古いリンクの受け皿:読み取ったレシートは明細の「確認が必要」で確かめる(ADR-127)。 */
export default function ReceiptPage() {
  redirect('/spending/review');
}
