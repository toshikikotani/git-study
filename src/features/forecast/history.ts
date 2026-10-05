/**
 * 予測の学習に使う、過去の明細(軽い読み方)。
 *
 * 季節を見るには1〜2年ぶんが要り、家計簿と同じ読み方(分割・品目の展開)で全部読むと重い。
 * そのため過去の分は、日付・金額・ジャンル・店名など学習に要る列だけを、1,000行ずつ
 * ページを分けて読む(PostgREST の1回あたり1,000行の上限で途中が欠けないように)。
 * 予測の対象の期間そのものは、家計簿と同じ読み方(entries.ts)で別に読む。
 */

import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { isMissingColumnError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';
import { todayJst, type DateOnly } from '@/lib/date';

const PAGE = 1000;
const COLUMNS =
  'occurred_on, amount_yen, genre_id, is_transfer, review_status, merchant_name, description';

export class ForecastHistoryError extends Error {}

export async function loadForecastHistory(range: {
  from: DateOnly;
  to: DateOnly;
}): Promise<ForecastSourceTransaction[]> {
  if (range.to < range.from) return [];
  const supabase = await createClient();
  const today = todayJst();

  const genres = await supabase.from('genres').select('id, name');
  if (genres.error) {
    throw new ForecastHistoryError(`ジャンルを取得できませんでした: ${genres.error.message}`);
  }
  const nameById = new Map(genres.data.map((g) => [g.id, g.name]));

  let withKind = true;
  const out: ForecastSourceTransaction[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const columns = withKind ? `${COLUMNS}, kind` : COLUMNS;
    const { data, error } = await supabase
      .from('transactions')
      .select(columns)
      .gte('occurred_on', range.from)
      .lte('occurred_on', range.to)
      .order('occurred_on', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      // kind 列が本番にまだ無い間は、列を外して読み直す(entries.ts と同じ扱い)。
      if (withKind && isMissingColumnError(error)) {
        withKind = false;
        offset -= PAGE;
        continue;
      }
      throw new ForecastHistoryError(`履歴を取得できませんでした: ${error.message}`);
    }
    const rows = data as unknown as {
      occurred_on: string;
      amount_yen: number;
      genre_id: string | null;
      is_transfer: boolean;
      review_status: ForecastSourceTransaction['reviewStatus'];
      merchant_name: string | null;
      description: string;
      kind?: string | null;
    }[];
    for (const row of rows) {
      out.push({
        occurredOn: row.occurred_on,
        genreId: row.genre_id,
        genreName: row.genre_id === null ? null : (nameById.get(row.genre_id) ?? null),
        amountYen: row.amount_yen,
        status: row.occurred_on > today ? 'scheduled' : 'actual',
        kind: row.kind === 'special' || row.kind === 'refund' ? row.kind : 'normal',
        isTransfer: row.is_transfer,
        reviewStatus: row.review_status,
        needsInput: false,
        merchantName: row.merchant_name,
        description: row.description,
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}
