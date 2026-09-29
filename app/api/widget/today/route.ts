import { NextResponse } from 'next/server';

import { loadGoalView } from '@/features/goals/loader';
import { buildWidgetSummary } from '@/features/goals/widget';
import { listOpenCaptures } from '@/features/receipt-captures/store';

/**
 * 「今日あと○円」と入力待ちの件数(ウィジェット・ショートカット用)。認証は proxy.ts が /api/* を守る。
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const [loaded, captures] = await Promise.all([
    loadGoalView().catch(() => null),
    listOpenCaptures().catch(() => []),
  ]);
  return NextResponse.json(buildWidgetSummary(loaded?.view ?? null, captures.length), {
    headers: { 'cache-control': 'no-store' },
  });
}
