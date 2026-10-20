import { redirect } from 'next/navigation';

/**
 * 古いリンクの受け皿:分析を浅くするため、この画面は 月のふりかえり のカード・分析 › 目標 にまとめた
 * (ADR-127)。
 */
export default function Page() {
  redirect('/reports/month');
}
