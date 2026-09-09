import { NextResponse } from 'next/server';

import { ClaudeEmailExtractor } from '@/features/import/email-ai';
import { parseNotificationEmail, type EmailParseResult } from '@/features/import/email';

/**
 * 貼り付けられたメール本文を解析する(FR-10)。
 *
 * ── なぜサーバー側なのか ────────────────────────────────────
 * ラベル辞書での解析だけならブラウザで完結する(貼り付け画面は実際そうしている)。
 * AI による救済には ANTHROPIC_API_KEY が要り、鍵をブラウザへ出すことはできない
 * (NFR-04)。そのため「辞書で読めなかったときだけ」ここへ来る。
 *
 * ── 認証 ────────────────────────────────────────────────────
 * proxy.ts の関所が /api/* を守る(M0-3)。未ログインならここに来る前に401。
 * 以下の呼び出し回数制限は、その上でなお課金APIを乱用から守るための歯止め。
 */

export const runtime = 'nodejs';

/** 1通の上限。通知メールは長くても数千文字。 */
const MAX_BODY_CHARS = 20_000;

/** 認証が入るまでの歯止め。プロセスが生きている間の AI 呼び出し回数。 */
const AI_CALL_LIMIT_PER_HOUR = 30;

let aiCallWindowStartedAt = 0;
let aiCallsInWindow = 0;

function takeAiCallSlot(): boolean {
  const now = Date.now();
  if (now - aiCallWindowStartedAt > 60 * 60 * 1000) {
    aiCallWindowStartedAt = now;
    aiCallsInWindow = 0;
  }
  if (aiCallsInWindow >= AI_CALL_LIMIT_PER_HOUR) return false;
  aiCallsInWindow += 1;
  return true;
}

type RequestBody = { body?: unknown; subject?: unknown };

export async function POST(request: Request): Promise<NextResponse> {
  let payload: RequestBody;
  try {
    payload = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'JSON として読めませんでした' }, { status: 400 });
  }

  const body = typeof payload.body === 'string' ? payload.body : '';
  if (body.trim() === '') {
    return NextResponse.json({ error: 'メール本文が空です' }, { status: 400 });
  }
  if (body.length > MAX_BODY_CHARS) {
    return NextResponse.json(
      { error: `本文が長すぎます(${MAX_BODY_CHARS} 文字まで)` },
      { status: 413 },
    );
  }
  const subject = typeof payload.subject === 'string' ? payload.subject : undefined;

  // まず費用のかからない辞書で読む。これで足りるなら AI は呼ばない。
  const byLabels = parseNotificationEmail(body);
  if (byLabels.transactions.length > 0) {
    return NextResponse.json(toResponse(byLabels, false));
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    return NextResponse.json(
      toResponse(
        {
          transactions: [],
          warnings: [
            ...byLabels.warnings,
            'AI による読み取りは設定されていません(ANTHROPIC_API_KEY が未設定)。',
          ],
        },
        false,
      ),
    );
  }

  if (!takeAiCallSlot()) {
    return NextResponse.json(
      toResponse(
        {
          transactions: [],
          warnings: [
            ...byLabels.warnings,
            'AI の呼び出しが混み合っています。時間をおいてください。',
          ],
        },
        false,
      ),
    );
  }

  const rescued = await new ClaudeEmailExtractor(apiKey).extract({ body, subject });
  if (rescued.transactions.length > 0) {
    return NextResponse.json(toResponse(rescued, true));
  }

  // 救済できなかったときは、辞書側の理由も併せて返す。原因が分かる方を捨てない。
  return NextResponse.json(
    toResponse({ transactions: [], warnings: [...byLabels.warnings, ...rescued.warnings] }, true),
  );
}

function toResponse(result: EmailParseResult, usedAi: boolean) {
  return { transactions: result.transactions, warnings: result.warnings, usedAi };
}
