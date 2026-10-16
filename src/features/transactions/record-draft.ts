/**
 * 記録するの下書き(ADR-098)。入れるたびに残しておき、保存せずに閉じても(つまみで閉じた・外を押した・
 * キャンセル・カメラへ移った)、次に開いたときに戻す。保存できたら消す。保存できなかったときも、ここに
 * 戻してシートを開き直す。この端末のこの画面のあいだだけ(サーバーには送らない・再読み込みで消える)。
 */

export type RecordDraft = {
  kind: 'expense' | 'income' | 'refund';
  /** 「1,200」のように、画面に出ている形。 */
  amount: string;
  genreId: string | null;
  date: string;
  name: string;
  memo: string;
  fixed: boolean;
  accountId: string;
};

let draft: RecordDraft | null = null;

/** 何か入れてあるか(金額・カテゴリ・レシート名・メモ)。種類や日付だけなら下書きにしない。 */
export function hasDraftContent(d: RecordDraft): boolean {
  return d.amount !== '' || d.genreId !== null || d.name.trim() !== '' || d.memo.trim() !== '';
}

/** 入れるたびに残す。何も入れていなければ残さない。 */
export function keepDraft(d: RecordDraft): void {
  draft = hasDraftContent(d) ? d : null;
}

/** 開くときに読む(読んでも消さない。保存できたら clearDraft で消す)。 */
export function peekDraft(): RecordDraft | null {
  return draft;
}

export function clearDraft(): void {
  draft = null;
}
