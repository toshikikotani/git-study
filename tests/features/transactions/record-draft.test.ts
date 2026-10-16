import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearDraft,
  hasDraftContent,
  keepDraft,
  peekDraft,
  type RecordDraft,
} from '@/features/transactions/record-draft';

const empty: RecordDraft = {
  kind: 'expense',
  amount: '',
  genreId: null,
  date: '2026-10-16',
  name: '',
  memo: '',
  fixed: false,
  accountId: 'a1',
};

describe('記録するの下書き(ADR-098)', () => {
  beforeEach(() => clearDraft());

  it('金額・カテゴリ・名前・メモのどれかが入っていれば残し、次に開いたときに戻す', () => {
    keepDraft({ ...empty, amount: '1,200' });
    expect(peekDraft()?.amount).toBe('1,200');
    // 読んでも消えない(開き直しても、保存するまで残る)
    expect(peekDraft()?.amount).toBe('1,200');
  });

  it('何も入れていなければ残さない', () => {
    keepDraft(empty);
    expect(peekDraft()).toBeNull();
    expect(hasDraftContent({ ...empty, kind: 'income', date: '2026-10-20' })).toBe(false);
    expect(hasDraftContent({ ...empty, genreId: 'food' })).toBe(true);
    expect(hasDraftContent({ ...empty, name: '  ' })).toBe(false);
  });

  it('保存したら消す', () => {
    keepDraft({ ...empty, memo: 'お釣り' });
    clearDraft();
    expect(peekDraft()).toBeNull();
  });
});
