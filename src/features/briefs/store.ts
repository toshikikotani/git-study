/**
 * 毎朝配信(daily_briefs)の生成と保存(M5-1、FR-30, FR-31)。
 *
 * 「いつ生成するか」(毎朝07:00 JST)は M5-2(配信ジョブ)の責務。ここは
 * 呼ばれたときに1回分を組み立てて保存するところまでを担う。
 *
 * 冒頭の数字(完済まで残り日数・使える残額)はホーム画面と必ず一致させる
 * 必要があるため、ホーム画面と同じ `loadHomeSummary()` をそのまま使う
 * (計算式を複製しない)。
 */

import { filterBriefTopics, pickDailyTopic } from '@/domain/briefs';
import { INCOME_TIP_BANK } from '@/features/briefs/tips';
import { loadHomeSummary } from '@/features/home/summary';
import { formatYen } from '@/domain/money';
import { todayJst, type DateOnly } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

export class BriefStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BriefStoreError';
  }
}

export type GenerateDailyBriefResult = {
  briefId: string;
  /** 既に当日分が生成済みで、新規作成しなかった場合は false。 */
  created: boolean;
};

/**
 * 当日分の配信を生成して保存する。
 *
 * `ux_briefs_user_date`(user_id, brief_on の一意制約)があるため、同じ日に
 * 二度呼んでも重複して作らない(既存の1件をそのまま返す)。
 */
export async function generateDailyBrief(
  now: Date = new Date(),
): Promise<GenerateDailyBriefResult> {
  const briefOn = todayJst(now);

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new BriefStoreError('ログイン状態を確認できませんでした');
  }

  const { data: existing, error: existingError } = await supabase
    .from('daily_briefs')
    .select('id')
    .eq('brief_on', briefOn)
    .maybeSingle();
  if (existingError) {
    throw new BriefStoreError(`既存の配信を確認できませんでした: ${existingError.message}`);
  }
  if (existing) {
    return { briefId: existing.id, created: false };
  }

  const summary = await loadHomeSummary(now);
  const livingTile = summary.tiles.find((tile) => tile.code === 'living');
  const sanctuaryTile = summary.tiles.find((tile) => tile.code === 'sanctuary');

  const topic = pickDailyTopic(INCOME_TIP_BANK, briefOn);
  const { included, excluded } = filterBriefTopics([topic]);

  const headlineTitle = buildHeadlineTitle(
    summary.payoff.daysRemaining,
    summary.payoff.remainingYen,
  );
  const bodyMd = buildBodyMd({
    headlineTitle,
    livingRemainingYen: livingTile?.remainingYen ?? null,
    sanctuaryRemainingYen: sanctuaryTile?.remainingYen ?? null,
    tip: included[0] ?? null,
  });

  const { data: brief, error: briefError } = await supabase
    .from('daily_briefs')
    .insert({
      user_id: auth.user.id,
      brief_on: briefOn,
      status: 'generated',
      days_to_payoff: summary.payoff.daysRemaining,
      remaining_debt_yen: summary.payoff.remainingYen,
      spendable_living_yen: livingTile?.remainingYen ?? null,
      spendable_sanctuary_yen: sanctuaryTile?.remainingYen ?? null,
      body_md: bodyMd,
      generated_at: new Date(now).toISOString(),
    })
    .select('id')
    .single();
  if (briefError) {
    throw new BriefStoreError(`配信を保存できませんでした: ${briefError.message}`);
  }

  const items = [
    {
      user_id: auth.user.id,
      brief_id: brief.id,
      kind: 'headline' as const,
      sort_order: 10,
      title: headlineTitle,
      summary: null,
    },
    ...included.map((candidate, index) => ({
      user_id: auth.user.id,
      brief_id: brief.id,
      kind: 'income_tip' as const,
      sort_order: 20 + index,
      title: candidate.title,
      summary: candidate.summary,
      source_name: candidate.sourceName,
    })),
  ];
  const { error: itemsError } = await supabase.from('brief_items').insert(items);
  if (itemsError) {
    throw new BriefStoreError(`配信の項目を保存できませんでした: ${itemsError.message}`);
  }

  if (excluded.length > 0) {
    const { error: excludedError } = await supabase.from('brief_excluded_items').insert(
      excluded.map((item) => ({
        user_id: auth.user.id,
        brief_id: brief.id,
        title: item.candidate.title,
        source_name: item.candidate.sourceName,
        reason: item.reason,
        reason_detail: item.reasonDetail,
      })),
    );
    if (excludedError) {
      throw new BriefStoreError(`除外ログを保存できませんでした: ${excludedError.message}`);
    }
  }

  return { briefId: brief.id, created: true };
}

export type BriefStatus = Database['public']['Enums']['brief_status'];
export type BriefItemKind = Database['public']['Enums']['brief_item_kind'];
export type BriefExclusionReasonValue = Database['public']['Enums']['brief_exclusion_reason'];

export type BriefListItem = {
  id: string;
  briefOn: DateOnly;
  status: BriefStatus;
  daysToPayoff: number | null;
  remainingDebtYen: number | null;
};

/** 過去の配信を新しい順に並べる(M5-3、FR-32)。 */
export async function listDailyBriefs(): Promise<BriefListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('daily_briefs')
    .select('id, brief_on, status, days_to_payoff, remaining_debt_yen')
    .order('brief_on', { ascending: false });
  if (error) throw new BriefStoreError(`配信の一覧を取得できませんでした: ${error.message}`);

  return data.map((row) => ({
    id: row.id,
    briefOn: row.brief_on,
    status: row.status,
    daysToPayoff: row.days_to_payoff,
    remainingDebtYen: row.remaining_debt_yen,
  }));
}

export type BriefDetailItem = {
  id: string;
  kind: BriefItemKind;
  title: string;
  summary: string | null;
};

export type BriefDetailExcludedItem = {
  id: string;
  title: string;
  reason: BriefExclusionReasonValue;
  reasonDetail: string | null;
};

export type BriefDetail = {
  id: string;
  briefOn: DateOnly;
  status: BriefStatus;
  items: BriefDetailItem[];
  excludedItems: BriefDetailExcludedItem[];
};

/**
 * 配信1件の詳細(M5-3)。本文は `brief_items` を並び順どおりに読む
 * (`body_md` は将来の配信チャネル向けの整形済みテキストで、画面表示は
 * 構造化されたデータの方がこのアプリの他画面と一貫する)。
 * 除外ログ(FR-31、なぜ載せなかったかが見える)も合わせて返す。
 */
export async function getDailyBrief(id: string): Promise<BriefDetail | null> {
  const supabase = await createClient();
  const { data: brief, error: briefError } = await supabase
    .from('daily_briefs')
    .select('id, brief_on, status')
    .eq('id', id)
    .maybeSingle();
  if (briefError) throw new BriefStoreError(`配信を取得できませんでした: ${briefError.message}`);
  if (!brief) return null;

  const [{ data: items, error: itemsError }, { data: excludedItems, error: excludedError }] =
    await Promise.all([
      supabase
        .from('brief_items')
        .select('id, kind, title, summary')
        .eq('brief_id', id)
        .order('sort_order', { ascending: true }),
      supabase
        .from('brief_excluded_items')
        .select('id, title, reason, reason_detail')
        .eq('brief_id', id),
    ]);
  if (itemsError)
    throw new BriefStoreError(`配信の項目を取得できませんでした: ${itemsError.message}`);
  if (excludedError) {
    throw new BriefStoreError(`除外ログを取得できませんでした: ${excludedError.message}`);
  }

  return {
    id: brief.id,
    briefOn: brief.brief_on,
    status: brief.status,
    items: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      summary: item.summary,
    })),
    excludedItems: excludedItems.map((item) => ({
      id: item.id,
      title: item.title,
      reason: item.reason,
      reasonDetail: item.reason_detail,
    })),
  };
}

function buildHeadlineTitle(daysRemaining: number | null, remainingYen: number): string {
  const daysText = daysRemaining === null ? '完済済み' : `完済まで残り${daysRemaining}日`;
  return `${daysText}・残債${formatYen(remainingYen, { sign: 'never' })}`;
}

function buildBodyMd(input: {
  headlineTitle: string;
  livingRemainingYen: number | null;
  sanctuaryRemainingYen: number | null;
  tip: { title: string; summary: string | null } | null;
}): string {
  const lines = [`## ${input.headlineTitle}`];
  if (input.livingRemainingYen !== null) {
    lines.push(`生活費: あと${formatYen(input.livingRemainingYen, { sign: 'never' })}使えます`);
  }
  if (input.sanctuaryRemainingYen !== null) {
    lines.push(`聖域: あと${formatYen(input.sanctuaryRemainingYen, { sign: 'never' })}使えます`);
  }
  if (input.tip) {
    lines.push('', `### ${input.tip.title}`);
    if (input.tip.summary) lines.push(input.tip.summary);
  }
  return lines.join('\n');
}
