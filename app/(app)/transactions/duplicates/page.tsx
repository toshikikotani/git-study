import { redirect } from 'next/navigation';

/** 古いリンクの受け皿:重複の確認は明細の「確認が必要」にまとめた(ADR-127)。 */
export default function DuplicatesPage() {
  redirect('/spending/review');
}
