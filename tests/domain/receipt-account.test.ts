import { describe, expect, it } from 'vitest';

import { cardLast4Of, guessReceiptAccount } from '@/domain/receipt-account';

/** レシートの支払い(口座)の当て方(v5 変更5、ADR-133)。 */
const accounts = [
  { id: 'cash', name: '現金' },
  { id: 'rakuten', name: '楽天カード', note: '末尾 1234' },
  { id: 'smbc', name: '三井住友カード 5678' },
];

describe('支払いの当て方', () => {
  it('カードの末尾4けたが登録した口座と合えば、自信あり', () => {
    expect(
      guessReceiptAccount({
        cardLast4: '1234',
        accounts,
        storeHistory: [],
        defaultAccountId: 'cash',
      }),
    ).toEqual({ accountId: 'rakuten', confidence: 1, reason: 'card' });
    expect(
      guessReceiptAccount({
        cardLast4: '************5678',
        accounts,
        storeHistory: [],
        defaultAccountId: 'cash',
      }).accountId,
    ).toBe('smbc');
  });

  it('そのお店で使った口座があれば、それを入れる(聞かない)', () => {
    expect(
      guessReceiptAccount({
        cardLast4: null,
        accounts,
        storeHistory: ['gone', 'smbc'],
        defaultAccountId: 'cash',
      }),
    ).toEqual({ accountId: 'smbc', confidence: 0.8, reason: 'history' });
  });

  it('手がかりがなく、そのお店で使った口座もなければ自信なし(いつもの口座を入れて聞く)', () => {
    expect(
      guessReceiptAccount({
        cardLast4: '9999',
        accounts,
        storeHistory: [],
        defaultAccountId: 'cash',
      }),
    ).toEqual({ accountId: 'cash', confidence: 0.4, reason: 'default' });
  });

  it('末尾4けたを取り出す', () => {
    expect(cardLast4Of('XXXX-XXXX-XXXX-４３２１')).toBe('4321');
    expect(cardLast4Of('')).toBeNull();
    expect(cardLast4Of(undefined)).toBeNull();
  });
});
