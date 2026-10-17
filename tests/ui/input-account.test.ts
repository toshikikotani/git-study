import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../app/(app)/accounts/actions', () => ({ ensureDefaultAccountAction: vi.fn() }));

import {
  InputAccountSelector,
  type useInputAccount,
} from '../../app/(app)/transactions/input-account';
import { CaptureCandidateCard } from '../../app/(app)/transactions/capture-candidate-card';

const cash = { id: 'cash', name: '現金', closingDay: null };
const card = { id: 'card', name: 'カード', closingDay: 15 };
const controller = (
  overrides: Partial<ReturnType<typeof useInputAccount>> = {},
): ReturnType<typeof useInputAccount> => ({
  accounts: [],
  accountId: '',
  setAccountId: vi.fn(),
  selectedAccount: null,
  loading: false,
  creating: false,
  error: null,
  retry: vi.fn(),
  createDefault: vi.fn(async () => {}),
  ...overrides,
});
const render = (overrides: Partial<ReturnType<typeof useInputAccount>>) =>
  renderToStaticMarkup(h(InputAccountSelector, { inputAccount: controller(overrides) }));

describe('入力途中の口座設定', () => {
  it('口座がなければ別画面へ移動せず、その場で作成できる', () => {
    const html = render({});
    expect(html).toContain('現金の口座を作って続ける');
    expect(html).toContain('入力内容を残したまま');
    expect(html).not.toContain('href=');
  });

  it('口座が1つなら選択操作を増やさず、保存先を示す', () => {
    const html = render({ accounts: [cash], accountId: cash.id, selectedAccount: cash });
    expect(html).toContain('現金');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('口座を作って');
  });

  it('複数口座なら現在の選択を示し、全口座に切り替えられる', () => {
    const html = render({ accounts: [cash, card], accountId: card.id, selectedAccount: card });
    expect(html).toContain('<select');
    expect(html).toContain('<option value="cash">現金</option>');
    expect(html).toContain('<option value="card" selected="">カード</option>');
  });

  it('読み込み中と取得失敗を、口座未登録と区別する', () => {
    const loading = render({ accounts: null, loading: true });
    expect(loading).toContain('口座を読み込んでいます');
    expect(loading).not.toContain('口座を作って');
    const failed = render({ accounts: null, error: '読み込みに失敗しました' });
    expect(failed).toContain('口座を再読み込みする');
    expect(failed).toContain('role="alert"');
    expect(failed).not.toContain('口座を作って');
  });

  it('口座準備中の再作成ボタンは無効にする', () => {
    const html = render({ creating: true });
    expect(html).toContain('disabled=""');
    expect(html).toContain('口座を用意しています');
  });

  it('保存先がない候補の保存を無効にし、保存失敗の理由も示す', () => {
    const html = renderToStaticMarkup(
      h(CaptureCandidateCard, {
        candidate: {
          occurredOn: '2026-10-17',
          amountYen: 500,
          storeName: 'テスト',
          genreId: null,
          confidence: 1,
        },
        genres: [],
        accountName: '口座を用意してください',
        status: 'error',
        saveDisabled: true,
        errorMessage: 'セッションが切れました',
        onChange: vi.fn(),
        onSave: vi.fn(),
        onDiscard: vi.fn(),
      }),
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>登録する<\/button>/);
    expect(html).toContain('セッションが切れました');
    expect(html).toContain('role="alert"');
  });
});
