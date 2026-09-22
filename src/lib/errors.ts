/**
 * アプリが自分で投げるエラーの基底(ADR-033)。
 *
 * これを継承した例外の message は、そのまま本人に見せてよい日本語であること。
 * 想定外の例外(DB ドライバや fetch が投げるもの)は継承していないため、
 * describeUserError() が差し替える。
 */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** 入力を伴う保存操作で想定外の例外が出たときの既定文。 */
const SAVE_FAILED = '保存に失敗しました。入力内容を確認してください。';

/** 想定内(AppError)はそのメッセージを、想定外は fallback を見せる。 */
export function describeUserError(error: unknown, fallback: string = SAVE_FAILED): string {
  return error instanceof AppError ? error.message : fallback;
}
