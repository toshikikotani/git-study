import { createHmac, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { DEFAULT_DETECTION_RULES } from '@/features/classification/rules';
import { listActiveClassificationRulesForUser } from '@/features/classification/store';
import { importLineReceiptAsAdmin } from '@/features/import/line-receipt';
import { ClaudeReceiptExtractor } from '@/features/import/receipt-ai';
import { getLineChannelSecret, getLineEnv, getLineReceiptAccountId } from '@/lib/env';
import { readAnthropicApiKey } from '@/lib/env';
import { fetchLineImageAsBase64, postLineMessage } from '@/lib/line';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * LINEでのレシート画像受信(受信 Webhook、本人発案)。
 *
 * ── 認証 ────────────────────────────────────────────────────
 * proxy.ts はこのパスを対象外にしている(LINE のサーバーはセッション
 * cookie を持たない)。代わりに LINE 公式の必須要件である
 * X-Line-Signature(チャネルシークレットで生 body を HMAC-SHA256 した値)
 * をここで自前検証する。
 *
 * ── 送信者の絞り込み ────────────────────────────────────────
 * LINE公式アカウントは友だち追加されれば誰からもメッセージを受け取れる。
 * source.userId が LINE_USER_ID(本人、getLineEnv() の送信先と同じ値)と
 * 一致しない画像は無視する(他人がこのアカウントを見つけて画像を送っても
 * 取り込ませない)。
 *
 * ── 複数レシート ────────────────────────────────────────────
 * LINE は1メッセージ=1画像として events 配列に積む(まとめて送っても複数の
 * message イベントに分かれて届く)。ここでは配列を順に処理するだけで、
 * 「複数レシート送信」(本人発案)に自然に対応できる。1画像=1バッチの原則
 * (features/import/receipt-storage.ts ヘッダー参照)もそのまま保たれる。
 *
 * ── 分類はルールのみ ────────────────────────────────────────
 * app/api/cron/import-gmail/route.ts と同じ方針(ADR-019)。詳細は
 * features/import/line-receipt.ts のヘッダー参照。
 */

export const runtime = 'nodejs';

type LineWebhookEvent = {
  type: string;
  message?: { type: string; id: string };
  source?: { type: string; userId?: string };
};

function isValidSignature(
  rawBody: string,
  signatureHeader: string | null,
  channelSecret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac('sha256', channelSecret).update(rawBody).digest('base64');

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export async function POST(request: Request): Promise<NextResponse> {
  const lineEnv = getLineEnv();
  const channelSecret = getLineChannelSecret();
  const accountId = getLineReceiptAccountId();
  if (!lineEnv || !channelSecret || !accountId) {
    return NextResponse.json({
      skipped: true,
      reason:
        'LINE経由のレシート受信は未設定です' +
        '(LINE_CHANNEL_ACCESS_TOKEN / LINE_USER_ID / LINE_CHANNEL_SECRET / LINE_RECEIPT_ACCOUNT_ID)',
    });
  }

  const rawBody = await request.text();
  if (!isValidSignature(rawBody, request.headers.get('x-line-signature'), channelSecret)) {
    return NextResponse.json({ error: '署名が正しくありません' }, { status: 401 });
  }

  let payload: { events?: LineWebhookEvent[] };
  try {
    payload = JSON.parse(rawBody) as { events?: LineWebhookEvent[] };
  } catch {
    return NextResponse.json({ error: 'JSONとして読めませんでした' }, { status: 400 });
  }

  const imageEvents = (payload.events ?? []).filter(
    (event): event is LineWebhookEvent & { message: { type: 'image'; id: string } } =>
      event.type === 'message' &&
      event.message?.type === 'image' &&
      event.source?.userId === lineEnv.LINE_USER_ID,
  );
  if (imageEvents.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  const anthropicApiKey = readAnthropicApiKey();
  if (anthropicApiKey === null) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY が未設定です' });
  }

  const admin = createAdminClient();
  const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers();
  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }
  const user = usersPage.users[0];
  if (!user) {
    return NextResponse.json({ skipped: true, reason: 'ユーザーが存在しません' });
  }

  const learnedRules = await listActiveClassificationRulesForUser(admin, user.id);
  const rules = [...DEFAULT_DETECTION_RULES, ...learnedRules];
  const extractor = new ClaudeReceiptExtractor(anthropicApiKey);

  const startedAtMs = Date.now();
  let processed = 0;
  const errors: string[] = [];
  for (const event of imageEvents) {
    const messageId = event.message.id;
    try {
      const imageBase64 = await fetchLineImageAsBase64(
        lineEnv.LINE_CHANNEL_ACCESS_TOKEN,
        messageId,
      );
      const result = await importLineReceiptAsAdmin(
        admin,
        user.id,
        accountId,
        rules,
        extractor,
        imageBase64,
        messageId,
      );
      await postLineMessage(
        lineEnv.LINE_CHANNEL_ACCESS_TOKEN,
        lineEnv.LINE_USER_ID,
        result.summaryText,
      ).catch(() => {});
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      await postLineMessage(
        lineEnv.LINE_CHANNEL_ACCESS_TOKEN,
        lineEnv.LINE_USER_ID,
        `レシートの取り込みに失敗しました: ${message}`,
      ).catch(() => {});
    }
  }

  const finishedAtMs = Date.now();
  await admin.from('job_runs').insert({
    user_id: user.id,
    job_name: 'import_line_receipt',
    status: errors.length === 0 ? 'succeeded' : processed > 0 ? 'succeeded' : 'failed',
    trigger_source: 'webhook',
    started_at: new Date(startedAtMs).toISOString(),
    finished_at: new Date(finishedAtMs).toISOString(),
    duration_ms: finishedAtMs - startedAtMs,
    items_processed: processed,
    error_message: errors.length > 0 ? errors.join('; ') : null,
    detail: { imageCount: imageEvents.length, processed, errorCount: errors.length },
  });

  return NextResponse.json({ processed });
}
