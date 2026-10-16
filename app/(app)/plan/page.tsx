import { redirect } from 'next/navigation';

/** 旧「見通し」。「分析 › 目標」にまとめた(ADR-091)。 */
export default function PlanPage() {
  redirect('/reports');
}
