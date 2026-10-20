import { redirect } from 'next/navigation';

/** 古いリンクの受け皿:設定は1画面にまとめた(ADR-127)。 */
export default function Page() {
  redirect('/settings');
}
