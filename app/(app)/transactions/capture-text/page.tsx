import { redirect } from 'next/navigation';

/**
 * 古いリンクの受け皿:「話して記録」「文字で記録」は AI のタブにまとめた(マイクでも文字でも記録できる、
 * ADR-127)。
 */
export default function CaptureTextPage() {
  redirect('/assistant');
}
