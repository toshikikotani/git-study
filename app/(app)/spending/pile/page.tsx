import { redirect } from 'next/navigation';

/** 古いリンクの受け皿:ちりつもは分析 › 月のふりかえりの「小口」カードにまとめた(ADR-127)。 */
export default function SpendingPilePage() {
  redirect('/reports/month');
}
