/**
 * 取り込み画面(CSV / メール貼り付け)共通の「口座一覧を取得する」呼び出し(M6-2)。
 *
 * 口座選択が無いまま取り込むと、transactions.account_id(NOT NULL な外部キー)
 * に実在しない値を渡すことになり保存が失敗する。取得に失敗しても画面は
 * 落とさず、空配列を返して呼び出し側が「口座が未登録」として案内する。
 */

export type AccountOption = { id: string; name: string };

export async function fetchAccounts(): Promise<AccountOption[]> {
  try {
    const response = await fetch('/api/accounts');
    if (!response.ok) return [];
    const data = (await response.json()) as { accounts: AccountOption[] };
    return data.accounts;
  } catch {
    return [];
  }
}
