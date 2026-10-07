import { redirect } from 'next/navigation';

/** 目標の画面は「貯金」(/savings)になった(ADR-077)。ブックマークされた旧URLを引き継ぐ。 */
export default function AdvisorPage() {
  redirect('/savings');
}
