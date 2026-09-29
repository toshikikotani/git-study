import { NextResponse } from 'next/server';

import { executeOperation, loadPlanContext } from '@/features/assistant/apply';
import type { AssistantChange } from '@/features/assistant/chat-tools';
import { isWriteToolName, MAX_CHANGES_PER_PROPOSAL, planToolCall } from '@/features/assistant/plan';
import { ChatToolError } from '@/lib/chat-tools';
import { describeUserError } from '@/lib/errors';

/**
 * 承認された変更案を実際に反映する(本人発案、ADR-059)。
 *
 * 確認カードで本人が承認した変更(ツール名+入力)だけがここへ来る。画面から
 * 戻ってきた値はそのまま信用せず、会話のときと同じ planToolCall() を
 * もう一度通す(検証・致命的な変更の拒否は、この関所が最終的な保証になる)。
 * 認証は proxy.ts の関所が /api/* を守り、書き込みは本人のセッションの
 * RLS がそのまま効く(admin client は使わない)。
 *
 * 1件が失敗しても残りは続ける(1件の不備で全部を止めると、本人が承認した
 * 他の変更まで反映されず、どこまで反映されたかも分かりにくくなる)。
 * 結果は1件ずつ返し、画面が成功・失敗を並べて見せる。
 */

export const runtime = 'nodejs';

export type ApplyResult =
  { ok: true; change: AssistantChange } | { ok: false; target: string; error: string };

type RequestBody = { changes?: unknown };

export async function POST(request: Request): Promise<NextResponse> {
  let payload: RequestBody;
  try {
    payload = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'JSON として読めませんでした' }, { status: 400 });
  }

  const rawChanges = Array.isArray(payload.changes) ? payload.changes : null;
  if (rawChanges === null || rawChanges.length === 0) {
    return NextResponse.json({ error: '反映する変更がありません' }, { status: 400 });
  }
  if (rawChanges.length > MAX_CHANGES_PER_PROPOSAL) {
    return NextResponse.json(
      { error: `一度に反映できるのは${MAX_CHANGES_PER_PROPOSAL}件までです` },
      { status: 400 },
    );
  }

  let planContext: Awaited<ReturnType<typeof loadPlanContext>>;
  try {
    planContext = await loadPlanContext();
  } catch (error) {
    return NextResponse.json(
      { error: describeUserError(error, '読み込みに失敗しました。') },
      { status: 500 },
    );
  }

  const results: ApplyResult[] = [];
  for (const raw of rawChanges) {
    const item = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const tool = typeof item.tool === 'string' ? item.tool : '';
    if (!isWriteToolName(tool)) {
      results.push({ ok: false, target: tool || '(不明)', error: '実行できない操作です。' });
      continue;
    }
    try {
      const { change, operation } = planToolCall(tool, item.input, planContext);
      try {
        await executeOperation(operation);
      } catch (error) {
        results.push({
          ok: false,
          target: change.target,
          error: describeUserError(error, '反映に失敗しました。'),
        });
        continue;
      }
      results.push({
        ok: true,
        change: { kind: change.kind, target: change.target, detail: change.detail },
      });
    } catch (error) {
      results.push({
        ok: false,
        target: tool,
        error:
          error instanceof ChatToolError
            ? error.message
            : describeUserError(error, '反映に失敗しました。'),
      });
    }
  }

  return NextResponse.json({ results });
}
