/**
 * LINE の会話(v4-2「LINEで完結」、ADR-130)。記録・質問・答え合わせを LINE で済ませる。
 * 文の読み方は domain/line-message.ts、ここはアプリの機能を呼んで返事を組み立てる。
 *
 * どれも本人として動いている間(lib/supabase/owner-session.ts の runAsOwner の中)に呼ぶ。その間は
 * アプリと同じ関数・同じ計算(今日の目安・もし使ったら・AIの窓口・答え合わせ)がそのまま使える。
 * 記録や変更は、本人がボタンを押すまでしない(AIの答えも同じ)。ボタンが運ぶ値は、受け取った側で
 * 本人の記録か・正しい値かを確かめてから使う。
 */

import { classifyImported } from '@/domain/import-classification';
import {
  checkSummaryText,
  parseLineText,
  parsePostback,
  postbackData,
  type LinePostback,
} from '@/domain/line-message';
import { comparableKey } from '@/domain/store-name';
import { LINE_TEXT_REF_PREFIX, type TodayCheckItem } from '@/domain/today-check';
import { whatIfRows, whatIfVerdict } from '@/domain/forecast/what-if-spend';
import { todayNumbersOf } from '@/features/advisor/context';
import { runAssistantTurn } from '@/features/assistant/turn';
import {
  loadImportClassifyContext,
  rememberStoreChoice,
} from '@/features/classification/import-classify';
import { simulateTodaySpends } from '@/features/forecast/what-if-spend';
import { fetchQuickEntryGenres } from '@/features/genre/store';
import { loadTodayForecasts } from '@/features/home/today-forecasts';
import { confirmSureTodayCheck, listTodayCheck } from '@/features/today-check/store';
import { fetchStoreGenres } from '@/features/transactions/store-genres';
import { importTransactions } from '@/features/transactions/store';
import { fingerprintOf, type StoredTransaction } from '@/features/transactions/types';
import { todayJst } from '@/lib/date';
import { lineText, type LineMessage, type LineQuickReplyButton } from '@/lib/line';
import { createClient } from '@/lib/supabase/server';

export type LineContext = {
  /** 受け取ったメッセージの ID(LINE の文字から入れた記録の source_ref に使う)。 */
  messageId: string;
  /** 記録を入れる口座(LINE_RECEIPT_ACCOUNT_ID、レシートと同じ)。 */
  accountId: string;
  /** アプリの URL(「1件ずつ見る」などのボタン)。無ければボタンを出さない。 */
  appBaseUrl: string | null;
};

const yen = (n: number) => `${Math.abs(n).toLocaleString('ja-JP')}円`;

async function owner() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('本人として読めませんでした');
  return { supabase, userId: data.user.id };
}

/** 受け取った文字への返事。 */
export async function replyToText(text: string, ctx: LineContext): Promise<LineMessage[]> {
  const intent = parseLineText(text);
  switch (intent.kind) {
    case 'record':
      return recordFromLine(intent.label, intent.amountYen, ctx);
    case 'remaining':
      return [lineText(await remainingText())];
    case 'what_if':
      return whatIfReply(intent.amountYen);
    case 'check':
      return checkReply(ctx);
    case 'ai':
      return aiReply(intent.text, ctx);
  }
}

/** ボタン(ポストバック)への返事。 */
export async function replyToPostback(data: string, ctx: LineContext): Promise<LineMessage[]> {
  const postback = parsePostback(data);
  if (postback === null)
    return [lineText('このボタンは使えなくなりました。もう一度送ってください。')];
  return handlePostback(postback, ctx);
}

// ---- 記録 -----------------------------------------------------------------------------------

async function guessGenre(label: string): Promise<{ genreId: string | null; sure: boolean }> {
  const { supabase, userId } = await owner();
  const [ctx, past] = await Promise.all([
    loadImportClassifyContext(supabase, userId),
    fetchStoreGenres().catch(() => [] as [string, string][]),
  ]);
  const hit = classifyImported({ merchantName: label, description: label }, ctx);
  if (hit.genreId !== null && hit.reviewStatus === 'auto_ok')
    return { genreId: hit.genreId, sure: true };
  // 同じ言葉で前に記録したカテゴリ(記録すると同じ覚え方)。
  const previous = new Map(past).get(comparableKey(label));
  if (previous) return { genreId: previous, sure: true };
  return { genreId: hit.genreId, sure: false };
}

async function recordFromLine(
  label: string,
  amountYen: number,
  ctx: LineContext,
  options: { sure?: boolean } = {},
): Promise<LineMessage[]> {
  const today = todayJst();
  const guess = await guessGenre(label);
  const sure = options.sure ?? guess.sure;
  const sourceRef = `${LINE_TEXT_REF_PREFIX}${ctx.messageId}`;
  const preview: StoredTransaction = {
    id: 'line-text-0',
    accountId: ctx.accountId,
    occurredOn: today,
    description: label,
    merchantName: label,
    amountYen: -amountYen,
    paymentMethod: 'one_time',
    genreId: guess.genreId,
    genreName: null,
    classifiedBy: guess.genreId ? 'rule' : 'unclassified',
    confidence: null,
    // カテゴリに自信があれば確定、なければ夜の答え合わせに回す。
    reviewStatus: sure && guess.genreId ? 'confirmed' : 'pending',
    mustPay: false,
    source: 'manual',
    fingerprint: fingerprintOf({ occurredOn: today, amountYen: -amountYen, description: label }),
    batchId: null,
    sourceRef,
    memo: null,
  };
  const result = await importTransactions([preview], {
    fileName: 'LINE',
    source: 'manual',
    accountId: ctx.accountId,
    failedCount: 0,
  });
  const inserted = result.insertedTransactions.find((t) => t.sourceRef === sourceRef);
  if (!inserted) {
    return [
      lineText(
        `今日はもう「${label} ${yen(amountYen)}」の記録があるので、入れませんでした。2回目なら言葉を少し変えて送ってください(例:${label}2 ${amountYen})。`,
      ),
    ];
  }

  const genres = await fetchQuickEntryGenres().catch(() => []);
  const genreName = genres.find((g) => g.id === guess.genreId)?.name ?? '未分類';
  const lines = [
    `記録しました:${label} ${yen(amountYen)}(${genreName}${preview.reviewStatus === 'pending' ? '・夜に確かめます' : ''})`,
    await remainingText(),
  ];
  return [
    lineText(lines.join('\n'), [
      {
        kind: 'postback',
        label: '取り消す',
        data: postbackData({ action: 'undo', id: inserted.id }),
        displayText: '取り消す',
      },
      {
        kind: 'postback',
        label: 'カテゴリを変える',
        data: postbackData({ action: 'genre', id: inserted.id }),
        displayText: 'カテゴリを変える',
      },
    ]),
  ];
}

// ---- 今日の目安・もし使ったら --------------------------------------------------------------

async function remainingText(): Promise<string> {
  try {
    const now = new Date();
    const forecasts = await loadTodayForecasts(now);
    const numbers = todayNumbersOf(forecasts, now);
    const tomorrow = forecasts.goalView?.tomorrowLimit?.todayLimitYen ?? null;
    const a = numbers.allowance;
    if (a === null)
      return '今期の目標が無いので、今日の目安はまだ出せません(アプリの分析で目標を立てると出ます)。';
    const head =
      a.kind === 'left'
        ? `今日あと ${yen(a.leftYen)} 使えます(目安 ${yen(a.capYen)}・使った ${yen(a.spentYen)})`
        : `今日は目安を ${yen(a.overYen)} こえています(目安 ${yen(a.capYen)}・使った ${yen(a.spentYen)})`;
    return tomorrow !== null ? `${head}\n明日からの目安:1日 ${yen(tomorrow)}` : head;
  } catch {
    return '今日の目安を計算できませんでした。少したってから「今日あといくら」と送ってください。';
  }
}

async function whatIfReply(amountYen: number): Promise<LineMessage[]> {
  try {
    const result = await simulateTodaySpends([amountYen], null);
    const option = result.options[0]!;
    const rows = whatIfRows(result.base, option).map(
      (r) => `・${r.label}:${r.before} → ${r.after}`,
    );
    const text = [
      `今日あと${yen(amountYen)}使ったら(${result.computedAt}時点のアプリの見通し)`,
      ...rows,
      whatIfVerdict(result, option),
    ].join('\n');
    return [
      lineText(text, [
        {
          kind: 'postback',
          label: '予定に入れる',
          data: postbackData({ action: 'plan', amountYen }),
          displayText: '予定に入れる',
        },
        {
          kind: 'postback',
          label: 'やめておく',
          data: postbackData({ action: 'noop' }),
          displayText: 'やめておく',
        },
      ]),
    ];
  } catch {
    return [lineText('見通しを計算できませんでした。少したってから、もう一度送ってください。')];
  }
}

// ---- 答え合わせ -------------------------------------------------------------------------------

function checkButtons(appBaseUrl: string | null, sure: boolean): LineQuickReplyButton[] {
  return [
    ...(sure
      ? [
          {
            kind: 'postback' as const,
            label: 'まとめて合ってる',
            data: postbackData({ action: 'check_sure' }),
            displayText: 'まとめて合ってる',
          },
        ]
      : []),
    ...(appBaseUrl
      ? [{ kind: 'uri' as const, label: '1件ずつ見る', uri: `${appBaseUrl}/?check=today` }]
      : []),
  ];
}

/** 夜の答え合わせ・「答え合わせ」と同じ中身(0件なら null)。 */
export function checkMessage(
  items: readonly TodayCheckItem[],
  appBaseUrl: string | null,
): LineMessage | null {
  if (items.length === 0) return null;
  return lineText(
    checkSummaryText(items),
    checkButtons(
      appBaseUrl,
      items.some((i) => !i.unsure),
    ),
  );
}

async function checkReply(ctx: LineContext): Promise<LineMessage[]> {
  const { supabase, userId } = await owner();
  const items = await listTodayCheck(supabase, userId, todayJst());
  return [checkMessage(items, ctx.appBaseUrl) ?? lineText('今日の答え合わせは、もうありません。')];
}

// ---- AI ---------------------------------------------------------------------------------------

async function aiReply(text: string, ctx: LineContext): Promise<LineMessage[]> {
  const result = await runAssistantTurn([{ role: 'user', content: text }]);
  if (!result.ok) return [lineText(result.error)];
  const { reply } = result;
  const lines = [reply.reply];
  if (reply.question) {
    // LINE では前のやり取りを持たないので、選んだあとの続きはアプリのAIで(選択肢は文で見せる)。
    lines.push(
      '',
      reply.question.question,
      ...reply.question.options.map((o) => `・${o.label}`),
      '続きはアプリのAIで選べます。',
    );
  }
  if (reply.proposal && reply.proposal.changes.length > 0) {
    lines.push(
      '',
      ...reply.proposal.changes.map((c) => `・${c.target}:${c.detail}`),
      'アプリのAIで確かめてから反映します(LINE からはまだ反映しません)。',
    );
  }
  const buttons: LineQuickReplyButton[] = [];
  if (ctx.appBaseUrl) {
    if ((reply.proposal && reply.proposal.changes.length > 0) || reply.question) {
      buttons.push({
        kind: 'uri',
        label: 'アプリのAIで確かめる',
        uri: `${ctx.appBaseUrl}/assistant`,
      });
    }
    for (const link of reply.links ?? []) {
      buttons.push({ kind: 'uri', label: link.label, uri: `${ctx.appBaseUrl}${link.href}` });
    }
  }
  return [lineText(lines.join('\n'), buttons)];
}

// ---- ボタン -------------------------------------------------------------------------------------

async function handlePostback(p: LinePostback, ctx: LineContext): Promise<LineMessage[]> {
  const { supabase, userId } = await owner();
  switch (p.action) {
    case 'noop':
      return [];
    case 'undo': {
      // 取り消せるのは、LINE の文字から入れた記録だけ。
      const { data: row } = await supabase
        .from('transactions')
        .select('id, description, amount_yen, source_ref')
        .eq('user_id', userId)
        .eq('id', p.id)
        .maybeSingle();
      if (!row || !row.source_ref?.startsWith(LINE_TEXT_REF_PREFIX)) {
        return [lineText('この記録はもう無いか、LINE からは取り消せません。')];
      }
      await supabase.from('transactions').delete().eq('user_id', userId).eq('id', p.id);
      return [lineText(`取り消しました:${row.description} ${yen(row.amount_yen)}`)];
    }
    case 'genre': {
      const genres = await fetchQuickEntryGenres();
      return [
        lineText(
          'どのカテゴリにしますか？',
          genres.slice(0, 12).map((g) => ({
            kind: 'postback' as const,
            label: g.name,
            data: postbackData({ action: 'set_genre', id: p.id, genreId: g.id }),
            displayText: g.name,
          })),
        ),
      ];
    }
    case 'set_genre': {
      const [{ data: row }, { data: genre }] = await Promise.all([
        supabase
          .from('transactions')
          .select('id, description, merchant_name')
          .eq('user_id', userId)
          .eq('id', p.id)
          .maybeSingle(),
        supabase
          .from('genres')
          .select('id, name')
          .eq('user_id', userId)
          .eq('id', p.genreId)
          .maybeSingle(),
      ]);
      if (!row || !genre) return [lineText('この記録かカテゴリが見つかりませんでした。')];
      await supabase
        .from('transactions')
        .update({
          genre_id: genre.id,
          classified_by: 'manual',
          review_status: 'corrected',
          reviewed_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('id', row.id);
      // 次から同じ言葉はこのカテゴリにする(答え合わせで直したのと同じ)。
      await rememberStoreChoice(supabase, userId, {
        storeName: row.merchant_name ?? row.description,
        genreId: genre.id,
        pin: true,
      }).catch(() => {});
      return [
        lineText(
          `「${row.description}」を${genre.name}にしました。次からも${genre.name}にします。`,
        ),
      ];
    }
    case 'check_sure': {
      const { confirmed, remaining } = await confirmSureTodayCheck(supabase, userId, todayJst());
      const head = `${confirmed}件を「合ってる」にしました。`;
      if (remaining.length === 0) return [lineText(`${head}今日の答え合わせはおしまいです。`)];
      return [
        lineText(
          `${head}\n${remaining.length === 1 ? '1件だけ' : `${remaining.length}件`}確かめてください:\n${remaining
            .slice(0, 3)
            .map((i) => `？${i.storeName} ${yen(i.amountYen)}(${i.genreName ?? '未分類'})`)
            .join('\n')}`,
          checkButtons(ctx.appBaseUrl, false),
        ),
      ];
    }
    case 'plan':
      // 今日の支出として入れ、夜の答え合わせで確かめる(あとで実際の支払いが来たら、そちらで直せる)。
      return recordFromLine('予定の支出', p.amountYen, ctx, { sure: false });
  }
}
