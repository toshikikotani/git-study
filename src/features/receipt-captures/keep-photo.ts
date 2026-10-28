/**
 * 撮ったレシートの写真を読み取り、「保存前」として残す(本人「自動登録機能は完全廃止、必ずユーザーが
 * 確認する」、ADR-141)。LINE で送った写真と iPhone アプリで撮った写真が使う。明細にはしない。
 *
 *   - 全部読めたら status = 'ready'(保存前)。Web で撮ったときと同じ行なので、「確認が必要」の
 *     保存前のレシートに並び、確かめて「保存」を押したときだけ明細になる。
 *   - 一部だけ・何も読めなければ status = 'needs_input'(入力待ち)。画像を見ながら入力する画面へ。
 *   - 同じ支払い(カードの通知メールなど)とのまとめも、確かめる画面で本人が選ぶ(ここではまとめない)。
 *
 * 本人のセッションの中で呼ぶ(LINE は runAsOwner、iPhone は withMobileSession)。行・画像は本人の物だけ
 * (RLS のまま)。
 */

import { judgeReadResult, needsManualInput } from '@/domain/receipt-capture';
import type { ReceiptGenreGuess } from '@/domain/unsaved-receipt';
import { loadClassificationMemory } from '@/features/genre/memory-store';
import { classifyReceiptPipeline } from '@/features/genre/receipt-classify';
import { listGenres } from '@/features/genre/store';
import type { AiReceiptExtractor, ParsedReceiptTransaction } from '@/features/import/receipt-ai';
import { uploadReceiptImage } from '@/features/import/receipt-storage';
import { todayJst } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import type { Json } from '@/lib/supabase/types';
import { keepReadyReceipts } from './keep-ready';
import { createCapture } from './store';

/** 保存前に残したレシート1件(知らせに出す分だけ)。 */
export type KeptReceipt = {
  /** receipt_captures の id(確かめる画面を開く)。 */
  id: string;
  storeName: string;
  occurredOn: string;
  /** 支払った額(正の円)。 */
  amountYen: number;
  /** いちばん大きい品目のカテゴリ(決まらなければ null。確かめる画面で選ぶ)。 */
  genreName: string | null;
};

export type KeepPhotoResult = {
  ready: KeptReceipt[];
  /** 読めなかった所があり、入力待ちにした行の id。 */
  needsInputId: string | null;
  warnings: string[];
  /** 残せなかった理由(読み取れない・保存前の表が無いなど)。残せたら null。 */
  error: string | null;
};

/** 明細 i の主なカテゴリ:品目が無ければ明細の分類、あれば金額のいちばん大きい品目の分類、無ければ店の種類。 */
export function mainGenreId(
  t: ParsedReceiptTransaction,
  index: number,
  classifications: readonly ReceiptGenreGuess[],
  parentGenreIds: Readonly<Record<number, string>>,
): string | null {
  const of = (key: string) => classifications.find((c) => c.key === key)?.genreId ?? null;
  if (t.items.length === 0) return of(`${index}`) ?? parentGenreIds[index] ?? null;
  let best: { amount: number; genreId: string | null } = { amount: -1, genreId: null };
  t.items.forEach((item, j) => {
    const amount = Math.abs(item.amountYen);
    if (amount > best.amount) best = { amount, genreId: of(`${index}:${j}`) };
  });
  return best.genreId ?? parentGenreIds[index] ?? null;
}

export async function keepReceiptPhotoForCheck(input: {
  apiKey: string;
  extractor: AiReceiptExtractor;
  imageBase64: string;
}): Promise<KeepPhotoResult> {
  const empty = { ready: [], needsInputId: null };
  const read = await input.extractor.extract({
    imageBase64: input.imageBase64,
    mediaType: 'image/jpeg',
  });
  const warnings = [...read.warnings];
  const judged = judgeReadResult(read.transactions);

  // 読めなかった所があれば、画像と読めた分を入力待ちに残す(何も読めなくても、写真から手で入れられる)。
  if (needsManualInput(judged.receiptStatus)) {
    try {
      const supabase = await createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return { ...empty, warnings, error: 'ログイン状態を確認できませんでした。' };
      const uploaded = await uploadReceiptImage(
        supabase,
        auth.user.id,
        input.imageBase64,
        'image/jpeg',
      );
      if (uploaded.path === null) {
        return { ...empty, warnings, error: uploaded.error ?? '画像を残せませんでした。' };
      }
      const id = await createCapture({
        imagePath: uploaded.path,
        receiptStatus: judged.receiptStatus,
        readFields: judged.readFields,
        unreadFields: judged.unreadFields,
        ocrRaw: { warnings, transactions: read.transactions } as unknown as Json,
        capturedOn: todayJst(),
      });
      return { ready: [], needsInputId: id, warnings, error: null };
    } catch {
      return { ...empty, warnings, error: '読み取れなかったレシートを残せませんでした。' };
    }
  }

  // カテゴリの当て方は Web で撮ったときと同じ(ルール → 履歴 → 品名の辞書 → AI)。確かめる画面で直せる。
  let classifications: ReceiptGenreGuess[] = [];
  let parentGenreIds: Record<number, string> = {};
  const genres = await listGenres().catch(() => []);
  try {
    const memory = await loadClassificationMemory();
    const outcome = await classifyReceiptPipeline(input.apiKey, read.transactions, genres, memory);
    classifications = outcome.classifications;
    parentGenreIds = Object.fromEntries(outcome.parentGenreIds);
    warnings.push(...outcome.warnings);
  } catch {
    warnings.push('カテゴリを当てられませんでした。確かめるときに選んでください。');
  }

  const kept = await keepReadyReceipts({
    imageBase64: input.imageBase64,
    transactions: read.transactions,
    warnings,
    classifications,
    parentGenreIds,
  });
  if (kept === null || kept.readyIds.length === 0) {
    return { ...empty, warnings, error: '保存前のレシートとして残せませんでした。' };
  }
  const nameOf = new Map(genres.map((g) => [g.id, g.name]));
  const ready = kept.readyIds.flatMap((id, i): KeptReceipt[] => {
    const t = read.transactions[i];
    if (!t) return [];
    const genreId = mainGenreId(t, i, classifications, parentGenreIds);
    return [
      {
        id,
        storeName: (t.storeName ?? '').trim() || t.description,
        occurredOn: t.occurredOn,
        amountYen: Math.abs(t.amountYen),
        genreName: genreId === null ? null : (nameOf.get(genreId) ?? null),
      },
    ];
  });
  return { ready, needsInputId: null, warnings, error: null };
}

/** 確かめる画面の場所(保存前は「確認が必要」のそのレシート、入力待ちは入力の画面)。 */
export function checkPathOf(result: Pick<KeepPhotoResult, 'ready' | 'needsInputId'>): string {
  if (result.ready[0]) return `/spending/review?receipt=${encodeURIComponent(result.ready[0].id)}`;
  if (result.needsInputId)
    return `/transactions/receipt/${encodeURIComponent(result.needsInputId)}`;
  return '/spending/review';
}
