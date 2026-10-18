/**
 * 予測の学習に使う、過去の明細(軽い読み方)。
 *
 * 季節を見るには1〜2年ぶんが要るため、学習に要る列だけを1,000行ずつ読む。
 * カテゴリは家計簿と同じく分割を展開し、親が未分類なら品目の代表ジャンルを使う。
 * 画像・メモなどの表示用データは読まない。
 */

import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { resolveItemGenres } from '@/features/genre/item-genres';
import { listSplitsForTransactionIds } from '@/features/transactions/splits-store';
import { isMissingColumnError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';
import { todayJst, type DateOnly } from '@/lib/date';

const PAGE = 1000;
const SPLIT_ID_CHUNK = 50;
const COLUMNS =
  'id, occurred_on, amount_yen, genre_id, is_transfer, review_status, merchant_name, description, must_pay, created_at';

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
    throw new ForecastHistoryError(`カテゴリを取得できませんでした: ${genres.error.message}`);
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
      id: string;
      occurred_on: string;
      amount_yen: number;
      genre_id: string | null;
      is_transfer: boolean;
      review_status: ForecastSourceTransaction['reviewStatus'];
      merchant_name: string | null;
      description: string;
      must_pay: boolean;
      created_at?: string | null;
      kind?: string | null;
    }[];

    // `.in()` を小分けにし、分割の取得が1回の応答上限で途中までにならないようにする。
    const splitChunks = [];
    for (let i = 0; i < rows.length; i += SPLIT_ID_CHUNK) {
      splitChunks.push(
        listSplitsForTransactionIds(
          supabase,
          rows.slice(i, i + SPLIT_ID_CHUNK).map((r) => r.id),
        ),
      );
    }
    const splitsById = new Map((await Promise.all(splitChunks)).flatMap((chunk) => [...chunk]));
    const itemGenre = await resolveItemGenres(rows.filter((r) => !splitsById.has(r.id)));

    for (const row of rows) {
      const genreId = row.genre_id ?? itemGenre.get(row.id) ?? null;
      const base: Omit<ForecastSourceTransaction, 'genreId' | 'genreName' | 'amountYen'> = {
        occurredOn: row.occurred_on,
        ...(row.created_at ? { createdOn: todayJst(new Date(row.created_at)) } : {}),
        status: row.occurred_on > today ? 'scheduled' : 'actual',
        kind: row.kind === 'special' || row.kind === 'refund' ? row.kind : 'normal',
        isTransfer: row.is_transfer,
        mustPay: row.must_pay,
        reviewStatus: row.review_status,
        needsInput: false,
        merchantName: row.merchant_name ?? row.description,
        description: row.description,
      };
      const splits = splitsById.get(row.id);
      // 壊れた分割は親へ戻す。家計簿と同じ検証を行い、合計を変えない。
      if (splits?.length && splits.reduce((sum, s) => sum + s.amountYen, 0) === row.amount_yen) {
        for (const split of splits) {
          const childGenreId = split.genreId ?? genreId;
          out.push({
            ...base,
            genreId: childGenreId,
            genreName: childGenreId === null ? null : (nameById.get(childGenreId) ?? null),
            amountYen: split.amountYen,
          });
        }
      } else {
        out.push({
          ...base,
          genreId,
          genreName: genreId === null ? null : (nameById.get(genreId) ?? null),
          amountYen: row.amount_yen,
        });
      }
    }
    if (rows.length < PAGE) break;
  }
  return out;
}
