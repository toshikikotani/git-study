/**
 * レシートの支払い(口座)の当て方と自信(v5 変更5、ADR-133)。
 *
 *   - レシートにカードの末尾4けたがあり、登録した口座(名前・メモ・カード会社名)の4けたと合う → 自信あり
 *   - そのお店で前に使った口座がある → 少し不安(聞かない。要約に入れて、押せば直せる)
 *   - 手がかりがなく、そのお店で使った口座もない → 自信なし(いつもの口座を入れて「聞く」)
 *
 * DB にも画面にも触れない純粋関数。
 */

export type AccountGuessReason = 'card' | 'history' | 'default';

export type AccountGuess = {
  accountId: string | null;
  confidence: number;
  reason: AccountGuessReason;
};

export type GuessableAccount = {
  id: string;
  name: string;
  institutionName?: string | null;
  note?: string | null;
};

/** 自信の値(bandOf で 自信あり / 少し不安 / 自信なし になる値)。 */
const CONFIDENCE: Record<AccountGuessReason, number> = { card: 1, history: 0.8, default: 0.4 };

/** レシートの「************1234」などから末尾4けたを取り出す。無ければ null。 */
export function cardLast4Of(text: string | null | undefined): string | null {
  if (!text) return null;
  const digits = text.normalize('NFKC').match(/(\d{4})(?!.*\d)/);
  return digits ? digits[1]! : null;
}

export function guessReceiptAccount(input: {
  cardLast4: string | null | undefined;
  accounts: readonly GuessableAccount[];
  /** このお店で使った口座(新しい順)。 */
  storeHistory: readonly string[];
  /** 記録するの既定の口座(現金 → 電子マネー → 1つめ)。 */
  defaultAccountId: string | null;
}): AccountGuess {
  const last4 = cardLast4Of(input.cardLast4);
  if (last4 !== null) {
    const hits = input.accounts.filter((a) =>
      [a.name, a.institutionName, a.note].some((t) => (t ?? '').normalize('NFKC').includes(last4)),
    );
    if (hits.length === 1)
      return { accountId: hits[0]!.id, confidence: CONFIDENCE.card, reason: 'card' };
  }
  const known = new Set(input.accounts.map((a) => a.id));
  const used = input.storeHistory.find((id) => known.has(id));
  if (used !== undefined)
    return { accountId: used, confidence: CONFIDENCE.history, reason: 'history' };
  return {
    accountId: input.defaultAccountId,
    confidence: CONFIDENCE.default,
    reason: 'default',
  };
}
