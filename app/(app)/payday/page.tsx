import { redirect } from 'next/navigation';

/** 古いリンクの受け皿:給料日は、今日の画面のカード(給料日)と設定から開くシートにした(ADR-127)。 */
export default function PaydayPage() {
  redirect('/settings');
}
