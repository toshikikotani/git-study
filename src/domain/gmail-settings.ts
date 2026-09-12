/**
 * Gmail 自動取得の設定値検証(T-22)。
 *
 * 資格情報(GMAIL_ADDRESS/GMAIL_APP_PASSWORD)は環境変数のみで扱い
 * (ADR-018、NFR-04)、ここで検証するのは DB(app_settings)に保存してよい
 * 値、つまり「有効にするか」「差出人を絞るか」「1回の取得件数上限」だけ。
 */

export class GmailSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailSettingsError';
  }
}

/**
 * 差出人の絞り込みリスト。前後の空白を取り除き、空文字の要素は拒否する。
 * 配列そのものが空なら「全件対象」を意味するため許可する
 * (`features/import/mailbox.ts` の buildImapSearch() が空配列を全件として扱う)。
 */
export function assertGmailFromAddresses(values: readonly string[]): string[] {
  const trimmed = values.map((v) => v.trim());
  if (trimmed.some((v) => v === '')) {
    throw new GmailSettingsError('空欄の差出人があります。削除するか、ドメインを入力してください');
  }
  return trimmed;
}

/** 1回の取得件数上限。DB 制約(ck_app_settings_gmail_limit)と同じ範囲。 */
export function assertGmailFetchLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    throw new GmailSettingsError(`取得件数の上限は1〜1000の整数で指定してください: ${value}`);
  }
  return value;
}
