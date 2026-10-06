/**
 * AIの読み(ADR-072)のデータアクセス。根拠に使う事実(目立つ明細・メモ・品目・予定)を集め、
 * 過去のAIの読みを月末の実際の着地と比べて当たり具合を数え、読みを保存・読み込む。
 *
 * ai_forecast_reads が本番に未適用の間は、保存を飛ばし、過去の読みは無いものとして扱う
 * (AIの読みは「半分だけ効かせる」既定で出る)。
 */

import { aiTrust, applyAiRead, type AiTrust, type ScoredRead } from '@/domain/ai-forecast-read';
import { actualTotalForPeriod } from '@/domain/forecast/backtest';
import { toForecastSource } from '@/features/forecast/source';
import { loadLedgerTransactions } from '@/features/spending/entries';
import type { LedgerTransaction } from '@/features/spending/ledger-types';
import { addDays, addMonths, type DateOnly } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';
import type { MonthlyReportEvidence } from './monthly-report-ai';

export class ForecastReadStoreError extends AppError {}

/** 金額の大きい明細と、メモのある明細を、それぞれこの件数まで渡す。 */
const MAX_LARGE = 8;
const MAX_MEMO = 8;
const MAX_SCHEDULED = 10;
const MAX_ITEMS_PER_TX = 6;
const ID_CHUNK = 20;
/** 当たり具合を数える、過去の月の数。 */
const PAST_MONTHS = 6;

/** 根拠に使う明細(今月の目立つもの・これからの予定)。品目はレシートの品目名。 */
export async function loadReadEvidence(
  transactions: readonly LedgerTransaction[],
  monthRange: { from: DateOnly; to: DateOnly },
  today: DateOnly,
): Promise<Pick<MonthlyReportEvidence, 'notable' | 'scheduled'>> {
  const inMonth = transactions.filter(
    (t) =>
      t.occurredOn >= monthRange.from &&
      t.occurredOn <= monthRange.to &&
      !t.isTransfer &&
      t.reviewStatus !== 'ignored' &&
      t.amountYen < 0,
  );
  const past = inMonth.filter((t) => t.occurredOn <= today);
  const large = [...past].sort((a, b) => a.amountYen - b.amountYen).slice(0, MAX_LARGE);
  const withMemo = past
    .filter((t) => (t.memo ?? '').trim() !== '' && !large.includes(t))
    .slice(0, MAX_MEMO);
  const notableTx = [...large, ...withMemo].sort((a, b) =>
    a.occurredOn.localeCompare(b.occurredOn),
  );
  const items = await loadItemNames(notableTx.map((t) => t.id));
  return {
    notable: notableTx.map((t) => ({
      date: t.occurredOn,
      label: t.label,
      amountYen: -t.amountYen,
      genre: t.genreName ?? '未分類',
      memo: t.memo?.trim() || null,
      items: items.get(t.id) ?? [],
    })),
    scheduled: inMonth
      .filter((t) => t.occurredOn > today)
      .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn))
      .slice(0, MAX_SCHEDULED)
      .map((t) => ({
        date: t.occurredOn,
        label: t.label,
        amountYen: -t.amountYen,
        genre: t.genreName ?? '未分類',
      })),
  };
}

async function loadItemNames(ids: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;
  const supabase = await createClient();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from('receipt_items')
      .select('transaction_id, name, sort_order')
      .in('transaction_id', ids.slice(i, i + ID_CHUNK))
      .order('sort_order');
    if (error) {
      if (isMissingTableError(error)) return out;
      throw new ForecastReadStoreError(`品目を取得できませんでした: ${error.message}`);
    }
    for (const row of data) {
      const list = out.get(row.transaction_id) ?? [];
      if (list.length < MAX_ITEMS_PER_TX) list.push(row.name);
      out.set(row.transaction_id, list);
    }
  }
  return out;
}

type ReadRow = {
  month: string;
  as_of: string;
  known_yen: number;
  stat_p10_yen: number;
  stat_p50_yen: number;
  stat_p90_yen: number;
  ai_percent: number;
  trust: number;
  adjusted_p50_yen: number;
  reason: string;
  evidence: string[];
  created_at: string;
};

const READ_COLUMNS =
  'month, as_of, known_yen, stat_p10_yen, stat_p50_yen, stat_p90_yen, ai_percent, trust, adjusted_p50_yen, reason, evidence, created_at';

/**
 * 過去の月のAIの読み(月ごとに最初の1回)と、その月の実際の着地。月の初めの読みほど
 * 当てるのが難しく、役に立つので、最初の読みで比べる(月末に作り直した読みで甘く数えない)。
 */
export async function loadScoredReads(
  monthStart: DateOnly,
  today: DateOnly,
): Promise<{ reads: ScoredRead[]; trust: AiTrust }> {
  const from = addMonths(monthStart, -PAST_MONTHS);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ai_forecast_reads')
    .select(READ_COLUMNS)
    .gte('month', from)
    .lt('month', monthStart)
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingTableError(error)) return { reads: [], trust: aiTrust([]) };
    throw new ForecastReadStoreError(`AIの読みを取得できませんでした: ${error.message}`);
  }
  const firstByMonth = new Map<string, ReadRow>();
  for (const row of data as ReadRow[]) {
    if (!firstByMonth.has(row.month)) firstByMonth.set(row.month, row);
  }
  if (firstByMonth.size === 0) return { reads: [], trust: aiTrust([]) };

  const { transactions } = await loadLedgerTransactions(
    { from, to: addDays(monthStart, -1) },
    today,
  );
  const source = toForecastSource(transactions);
  const reads = [...firstByMonth.values()].map((row): ScoredRead => ({
    month: row.month.slice(0, 7),
    percent: row.ai_percent,
    statP50Yen: row.stat_p50_yen,
    adjustedP50Yen: row.adjusted_p50_yen,
    actualYen: actualTotalForPeriod(source, {
      from: row.month,
      to: addDays(addMonths(row.month, 1), -1),
    }),
  }));
  return { reads, trust: aiTrust(reads) };
}

/** 画面に出すAIの読み(保存した値から、帯も同じ式で出し直す)。 */
export type ForecastReadView = {
  asOf: DateOnly;
  createdAt: string;
  knownYen: number;
  stat: { p10: number; p50: number; p90: number };
  percent: number;
  trust: number;
  adjusted: { p10: number; p50: number; p90: number; effectivePercent: number };
  reason: string;
  evidence: readonly string[];
};

function viewOf(row: ReadRow): ForecastReadView {
  const stat = { p10: row.stat_p10_yen, p50: row.stat_p50_yen, p90: row.stat_p90_yen };
  return {
    asOf: row.as_of,
    createdAt: row.created_at,
    knownYen: row.known_yen,
    stat,
    percent: row.ai_percent,
    trust: Number(row.trust),
    adjusted: applyAiRead({
      knownYen: row.known_yen,
      band: stat,
      percent: row.ai_percent,
      weight: Number(row.trust),
    }),
    reason: row.reason,
    evidence: row.evidence,
  };
}

/** 今月の最新のAIの読み。無ければ(テーブル未作成も含めて)null。 */
export async function loadLatestRead(monthStart: DateOnly): Promise<ForecastReadView | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ai_forecast_reads')
    .select(READ_COLUMNS)
    .eq('month', monthStart)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    if (isMissingTableError(error)) return null;
    throw new ForecastReadStoreError(`AIの読みを取得できませんでした: ${error.message}`);
  }
  const row = (data as ReadRow[])[0];
  return row ? viewOf(row) : null;
}

/** AIの読みを1行足す(上書きしない)。テーブル未作成なら保存せず、計算した値だけ返す。 */
export async function saveForecastRead(input: {
  monthStart: DateOnly;
  asOf: DateOnly;
  knownYen: number;
  stat: { p10: number; p50: number; p90: number };
  percent: number;
  trust: number;
  reason: string;
  evidence: readonly string[];
}): Promise<ForecastReadView> {
  const adjusted = applyAiRead({
    knownYen: input.knownYen,
    band: input.stat,
    percent: input.percent,
    weight: input.trust,
  });
  const row: ReadRow = {
    month: input.monthStart,
    as_of: input.asOf,
    known_yen: input.knownYen,
    stat_p10_yen: input.stat.p10,
    stat_p50_yen: input.stat.p50,
    stat_p90_yen: input.stat.p90,
    ai_percent: input.percent,
    trust: Math.round(input.trust * 1000) / 1000,
    adjusted_p50_yen: adjusted.p50,
    reason: input.reason,
    evidence: [...input.evidence],
    created_at: new Date().toISOString(),
  };
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new ForecastReadStoreError('ログイン状態を確認できませんでした');
  }
  const { error } = await supabase.from('ai_forecast_reads').insert({
    user_id: auth.user.id,
    month: row.month,
    as_of: row.as_of,
    known_yen: row.known_yen,
    stat_p10_yen: row.stat_p10_yen,
    stat_p50_yen: row.stat_p50_yen,
    stat_p90_yen: row.stat_p90_yen,
    ai_percent: row.ai_percent,
    trust: row.trust,
    adjusted_p50_yen: row.adjusted_p50_yen,
    reason: row.reason,
    evidence: row.evidence,
  });
  if (error && !isMissingTableError(error)) {
    throw new ForecastReadStoreError(`AIの読みを保存できませんでした: ${error.message}`);
  }
  return viewOf(row);
}
