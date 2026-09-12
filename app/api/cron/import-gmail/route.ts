import { randomUUID, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { DEFAULT_DETECTION_RULES } from '@/features/classification/rules';
import { listActiveClassificationRulesForUser } from '@/features/classification/store';
import { ClaudeEmailExtractor } from '@/features/import/email-ai';
import { GMAIL_IMAP } from '@/features/import/mailbox';
import { ImapMailSource } from '@/features/import/imap-source';
import { syncFromMailbox } from '@/features/import/mail-sync';
import { getCronSecret, getGmailEnv, getGmailImportAccountId } from '@/lib/env';
import { addDays, todayJst } from '@/lib/date';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Gmail 通知メールの自動取り込み(M2-7c、ADR-018)。
 *
 * 毎朝 GitHub Actions が叩く。本人のセッション(cookie)が無い経路のため、
 * `features/transactions/store.ts`(RLS 前提)は使わず、`createAdminClient()`
 * + 明示的な user_id でここに直接書く(`app/api/cron/keepalive/route.ts` と
 * 同じ考え方)。
 *
 * 取り込み先の口座は環境変数 `GMAIL_IMPORT_ACCOUNT_ID` で指定する。
 * `app_settings`(gmail_enabled 等)に持たせなかったのは、これを編集する
 * 画面をまだ持たないため(M6-2 より後に生まれた要件で、ADR-018 の設計時点では
 * 口座という概念自体が無かった)。GMAIL_ADDRESS / GMAIL_APP_PASSWORD と同じ、
 * Vercel の環境変数 + GitHub Secrets だけで設定が完結する経路にした。
 */

export const runtime = 'nodejs';

/** 1回の実行で AI に投げる上限(費用が青天井にならないための歯止め)。 */
const AI_CALL_LIMIT_PER_RUN = 20;

/** 初回実行(gmail_last_synced_on が未設定)で遡る日数。受信箱全体は読まない。 */
const INITIAL_LOOKBACK_DAYS = 7;

function isAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${getCronSecret()}`;

  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);
  if (headerBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(headerBuf, expectedBuf);
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: '認証情報が正しくありません' }, { status: 401 });
  }

  const gmailEnv = getGmailEnv();
  const accountId = getGmailImportAccountId();
  if (!gmailEnv || !accountId) {
    return NextResponse.json({
      skipped: true,
      reason:
        'Gmail 連携は未設定です(GMAIL_ADDRESS / GMAIL_APP_PASSWORD / GMAIL_IMPORT_ACCOUNT_ID)',
    });
  }

  const startedAtMs = Date.now();
  const admin = createAdminClient();

  const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers();
  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }
  const user = usersPage.users[0];
  if (!user) {
    return NextResponse.json({ skipped: true, reason: 'ユーザーが存在しません' });
  }

  const { data: settings, error: settingsError } = await admin
    .from('app_settings')
    .select('gmail_enabled, gmail_from_addresses, gmail_fetch_limit, gmail_last_synced_on')
    .eq('user_id', user.id)
    .single();
  if (settingsError) {
    return NextResponse.json({ error: settingsError.message }, { status: 500 });
  }

  if (!settings.gmail_enabled) {
    return NextResponse.json({ skipped: true, reason: 'app_settings.gmail_enabled が false です' });
  }

  const { data: account, error: accountError } = await admin
    .from('accounts')
    .select('id')
    .eq('id', accountId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (accountError) {
    return NextResponse.json({ error: accountError.message }, { status: 500 });
  }
  if (!account) {
    return NextResponse.json(
      { error: `GMAIL_IMPORT_ACCOUNT_ID(${accountId})が本人の口座に見つかりません` },
      { status: 500 },
    );
  }

  const { data: knownRefRows, error: knownRefError } = await admin
    .from('transactions')
    .select('source_ref')
    .eq('user_id', user.id)
    .eq('source', 'gmail')
    .not('source_ref', 'is', null);
  if (knownRefError) {
    return NextResponse.json({ error: knownRefError.message }, { status: 500 });
  }
  const knownMessageIds = new Set(
    knownRefRows.map((r) => r.source_ref).filter((v): v is string => v !== null),
  );

  const learnedRules = await listActiveClassificationRulesForUser(admin, user.id);
  const rules = [...DEFAULT_DETECTION_RULES, ...learnedRules];

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const since = settings.gmail_last_synced_on ?? addDays(todayJst(), -INITIAL_LOOKBACK_DAYS);

  const source = new ImapMailSource({
    ...GMAIL_IMAP,
    user: gmailEnv.GMAIL_ADDRESS,
    password: gmailEnv.GMAIL_APP_PASSWORD,
  });

  const syncResult = await syncFromMailbox({
    source,
    accountId,
    query: {
      since,
      fromAddresses: settings.gmail_from_addresses.length
        ? settings.gmail_from_addresses
        : undefined,
      limit: settings.gmail_fetch_limit,
    },
    rules,
    knownMessageIds,
    // fingerprint の一意制約は DB 側(transactions.upsert)が最終的に守る。
    // ここでの重複判定は同一実行内(同じメールから複数件抽出された場合)だけで十分。
    knownFingerprints: new Set(),
    batchId: randomUUID(),
    ai: anthropicApiKey
      ? { extractor: new ClaudeEmailExtractor(anthropicApiKey), maxCalls: AI_CALL_LIMIT_PER_RUN }
      : undefined,
  });

  const { data: batch, error: batchError } = await admin
    .from('import_batches')
    .insert({
      user_id: user.id,
      source: 'gmail',
      account_id: accountId,
      file_name: null,
      row_count: syncResult.transactions.length,
      failed_count: syncResult.warnings.length,
      status: 'pending',
    })
    .select('id')
    .single();
  if (batchError) {
    return NextResponse.json({ error: batchError.message }, { status: 500 });
  }

  let importedCount = 0;
  let duplicateCount = 0;

  if (syncResult.transactions.length > 0) {
    const { data: inserted, error: insertError } = await admin
      .from('transactions')
      .upsert(
        syncResult.transactions.map((t) => ({
          user_id: user.id,
          account_id: accountId,
          occurred_on: t.occurredOn,
          description: t.description,
          merchant_name: t.merchantName,
          amount_yen: t.amountYen,
          payment_method: t.paymentMethod,
          category_id: t.categoryId,
          classified_by: t.classifiedBy,
          confidence: t.confidence,
          review_status: t.reviewStatus,
          source: 'gmail' as const,
          import_batch_id: batch.id,
          fingerprint: t.fingerprint,
          source_ref: t.sourceRef,
        })),
        { onConflict: 'user_id,fingerprint', ignoreDuplicates: true },
      )
      .select('id');

    if (insertError) {
      await admin
        .from('import_batches')
        .update({
          status: 'failed',
          error_message: insertError.message,
          completed_at: new Date().toISOString(),
        })
        .eq('id', batch.id);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    importedCount = inserted.length;
    duplicateCount = syncResult.transactions.length - importedCount;
  }

  await admin
    .from('import_batches')
    .update({
      imported_count: importedCount,
      duplicate_count: duplicateCount,
      status: 'succeeded',
      completed_at: new Date().toISOString(),
    })
    .eq('id', batch.id);

  await admin
    .from('app_settings')
    .update({ gmail_last_synced_on: todayJst() })
    .eq('user_id', user.id);

  const finishedAtMs = Date.now();
  await admin.from('job_runs').insert({
    user_id: user.id,
    job_name: 'import_gmail',
    status: 'succeeded',
    trigger_source: 'github_actions',
    started_at: new Date(startedAtMs).toISOString(),
    finished_at: new Date(finishedAtMs).toISOString(),
    duration_ms: finishedAtMs - startedAtMs,
    items_processed: importedCount,
    detail: {
      scannedMessageCount: syncResult.scannedMessageCount,
      importedCount,
      duplicateCount,
      warningCount: syncResult.warnings.length,
      aiCallCount: syncResult.aiCallCount,
    },
  });

  return NextResponse.json({
    scannedMessageCount: syncResult.scannedMessageCount,
    importedCount,
    duplicateCount,
    warningCount: syncResult.warnings.length,
    aiCallCount: syncResult.aiCallCount,
  });
}
