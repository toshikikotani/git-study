import { redirect } from 'next/navigation';

/** 古いリンクの受け皿:使っていない画面は外した(データは残す、ADR-127)。 */
export default function Page() {
  redirect('/settings');
}
