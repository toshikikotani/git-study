/**
 * iPhone アプリとサーバーの約束(`/api/mobile/*` の受け渡しの形、ADR-132)。
 *
 * 型だけを置く(iPhone アプリの mobile/ からも読む。ここから何も読み込まない)。数字の計算は
 * サーバー側で Web と同じ関数を使い、アプリは出すだけにする(Web とアプリで数字がずれない)。
 */

/** GET /api/mobile/today */
export type MobileToday = {
  /** 日本時間の今日('YYYY-MM-DD')。 */
  today: string;
  /** 今日の目安。目標が無ければ null(アプリは「目標を決める」を出す)。 */
  allowance: { kind: 'left' | 'over'; yen: number } | null;
  /** 記録が少ないので仮の目安。 */
  provisional: boolean;
  /** 明日からの1日の目安(今日が期間の最終日なら null)。 */
  tomorrowYen: number | null;
  /** 今期の見通し(目標が無ければ null)。 */
  outlook: {
    /** 「10/1〜10/31 · 残り11日」 */
    periodLabel: string;
    spentYen: number;
    /** 見込み(中央)。 */
    p50Yen: number;
    budgetYen: number;
    /** 目標内に収まる確率(0〜1)。出せなければ null。 */
    probWithin: number | null;
  } | null;
  /** 今日やること(Web の「今日やること」と同じ数え方、ADR-131)。 */
  todo: { checkCount: number; capturesCount: number; payday: boolean };
  /** 今日の記録(新しい順)。 */
  records: MobileRecord[];
};

export type MobileRecord = {
  id: string;
  occurredOn: string;
  label: string;
  /** 支出は負、収入は正(ADR-008)。 */
  amountYen: number;
  genreId: string | null;
  genreName: string | null;
};

/** GET /api/mobile/genres(記録するのカテゴリ。よく使う順)。 */
export type MobileGenre = { id: string; name: string };

/** POST /api/mobile/records */
export type MobileRecordInput = {
  /** 支出の額(正の円)。 */
  amountYen: number;
  genreId: string | null;
  /** 'YYYY-MM-DD'。無ければ今日。 */
  occurredOn?: string;
  /** 店名・メモ。無ければカテゴリの名前。 */
  label?: string;
};

export type MobileRecordResult = { record: MobileRecord | null; error: string | null };

/** POST /api/mobile/receipts(撮ったレシートの写真。JPEG の base64)。 */
export type MobileReceiptInput = { image: string };

/** 保存前に残したレシート1件。 */
export type MobileKeptReceipt = {
  id: string;
  storeName: string;
  occurredOn: string;
  /** 支払った額(正の円)。 */
  amountYen: number;
  /** 当てたカテゴリ(決まらなければ null。確かめるときに選ぶ)。 */
  genreName: string | null;
};

/**
 * 撮ったレシートは読み取って「保存前」に残す。明細にはしない(本人が確かめて「保存」を押したときだけ記録、
 * ADR-141)。確かめるのは Web の「確認が必要」(checkPath を API の URL につなげて開く)。
 */
export type MobileReceiptResult = {
  ready: MobileKeptReceipt[];
  /** 読めなかった所があり、入力待ち(写真を見ながら入れる)にした。 */
  needsInput: boolean;
  /** 確かめる画面のパス(`/spending/review?receipt=…` など)。 */
  checkPath: string;
  warnings: string[];
  error: string | null;
};

/** POST /api/mobile/records/undo(いま入れた記録を取り消す。アプリから入れた記録だけ)。 */
export type MobileUndoInput = { ids: string[] };
export type MobileUndoResult = { removed: number; error: string | null };
