/**
 * 今日の答え合わせ(v4-1、ADR-129):自動で入った記録を1枚ずつ確かめる。どれを出すか・どの順か・
 * カードに何と書くかを決める。DBにもネットワークにも触れない。
 *
 * 出すのは、自動で入った(Gmail のカードの通知メール・CSV・LINE のレシート・LINE の文字)明細のうち、
 * まだ確かめていない(auto_ok・pending)もの。手入力とアプリで撮ったレシートは、本人が確かめて入れている
 * ので出さない。今日の分を先に、前の日(直近 {@link CHECK_WINDOW_DAYS} 日)の片づけ残しをあとに続ける。
 *
 * カテゴリの確認待ち(pending)は、いつの・どこから入った記録でも出す。今日の画面で「確認待ち」と
 * 「答え合わせ」が同じ記録を別の数で数えていたので、答え合わせ1つにまとめた(ADR-131)。
 */

import { addDays, type DateOnly } from '@/lib/date';

/** 今日を含めて何日前までの片づけ残しを出すか。 */
export const CHECK_WINDOW_DAYS = 7;

export type CheckSource = 'gmail' | 'csv' | 'line_receipt' | 'line_text' | 'app';

export const CHECK_SOURCE_LABEL: Record<CheckSource, string> = {
  gmail: 'カードの通知メール',
  csv: 'CSV',
  line_receipt: 'LINEのレシート',
  line_text: 'LINE',
  app: 'アプリ',
};

/** LINE の文字から入れた記録の source_ref の頭(LINE のレシートは `line-<メッセージID>-<番号>`)。 */
export const LINE_TEXT_REF_PREFIX = 'line-text-';

/** 自動で入った記録か(そうならどこから)。手入力・アプリのレシートは null。 */
export function checkSourceOf(source: string, sourceRef: string | null): CheckSource | null {
  if (source === 'gmail') return 'gmail';
  if (source === 'csv') return 'csv';
  if (source === 'manual' && sourceRef?.startsWith(LINE_TEXT_REF_PREFIX)) return 'line_text';
  if (source === 'manual' && sourceRef?.startsWith('line-')) return 'line_receipt';
  return null;
}

export function checkWindowStart(today: DateOnly): DateOnly {
  return addDays(today, -(CHECK_WINDOW_DAYS - 1));
}

export type CheckRow = {
  id: string;
  occurredOn: DateOnly;
  createdAt: string;
  merchantName: string | null;
  description: string;
  branchName: string | null;
  amountYen: number;
  genreId: string | null;
  reviewStatus: string;
  source: string;
  sourceRef: string | null;
  isTransfer: boolean;
};

export type TodayCheckItem = {
  id: string;
  occurredOn: DateOnly;
  isToday: boolean;
  /** 「12:34」(取り込んだ時刻、日本時間)。 */
  time: string;
  storeName: string;
  /** 支店か、最初の品目。無ければ null。 */
  detail: string | null;
  /** 支出は正の円(収入・返金は負)。 */
  amountYen: number;
  genreId: string | null;
  genreName: string | null;
  source: CheckSource;
  sourceLabel: string;
  /** カテゴリに自信がない(pending)。オレンジの枠で囲む。 */
  unsure: boolean;
  /** 自動で1件にまとめたときの説明。 */
  mergedNote: string | null;
};

/** 日本時間の「12:34」。 */
export function jstTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(11, 16);
}

/**
 * 出す行を選んで、今日の分(新しく入った順)→ 前の日(新しい日から)の順に並べる。
 * 確かめ済み・数えない・振替・0円・先の日付の行は出さない。自動で入っていない行と、直近
 * {@link CHECK_WINDOW_DAYS} 日より前の行は、カテゴリの確認待ち(pending)のときだけ出す。
 */
export function pickCheckItems(
  rows: readonly CheckRow[],
  today: DateOnly,
  extras: {
    genreNameById: ReadonlyMap<string, string>;
    firstItemById?: ReadonlyMap<string, string>;
    mergedNoteById?: ReadonlyMap<string, string>;
  },
): TodayCheckItem[] {
  const from = checkWindowStart(today);
  const items: TodayCheckItem[] = [];
  for (const row of rows) {
    if (row.reviewStatus !== 'auto_ok' && row.reviewStatus !== 'pending') continue;
    if (row.isTransfer || row.amountYen === 0) continue;
    if (row.occurredOn > today) continue;
    const pending = row.reviewStatus === 'pending';
    const auto = checkSourceOf(row.source, row.sourceRef);
    if (!pending && (auto === null || row.occurredOn < from)) continue;
    const source = auto ?? 'app';
    items.push({
      id: row.id,
      occurredOn: row.occurredOn,
      isToday: row.occurredOn === today,
      time: jstTime(row.createdAt),
      storeName: (row.merchantName ?? '').trim() || row.description,
      detail: row.branchName?.trim() || extras.firstItemById?.get(row.id) || null,
      amountYen: -row.amountYen,
      genreId: row.genreId,
      genreName: row.genreId === null ? null : (extras.genreNameById.get(row.genreId) ?? null),
      source,
      sourceLabel: CHECK_SOURCE_LABEL[source],
      unsure: row.reviewStatus === 'pending',
      mergedNote: extras.mergedNoteById?.get(row.id) ?? null,
    });
  }
  return items.sort((a, b) =>
    a.isToday !== b.isToday
      ? a.isToday
        ? -1
        : 1
      : a.occurredOn !== b.occurredOn
        ? b.occurredOn.localeCompare(a.occurredOn)
        : b.time.localeCompare(a.time),
  );
}
