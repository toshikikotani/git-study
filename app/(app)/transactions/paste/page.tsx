import { redirect } from 'next/navigation';

/** 古いリンクの受け皿:メールを貼る画面は「メールから取り込む」1つにまとめた(ADR-127)。 */
export default function Page() {
  redirect('/transactions/email');
}
