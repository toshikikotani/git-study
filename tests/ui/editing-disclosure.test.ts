import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../app/(app)/plan/actions', () => ({ planLandingAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AccountForm } from '../../app/(app)/accounts/account-form';
import { PlanPeriodForm } from '../../app/(app)/plan/edit-plan-section';
import { AllocationEditor } from '../../app/(app)/plan/allocation-editor';
import type { Account } from '@/features/accounts/store';

const account: Account = {
  id: 'a',
  name: '口座',
  institutionName: '銀行',
  kind: 'bank',
  purpose: 'salary',
  closingDay: null,
  paymentDay: 25,
  currentBalanceYen: 1000,
  balanceUpdatedOn: null,
  isActive: true,
  note: 'メモ',
};

describe('通常の操作から詳しい調整を開く', () => {
  it('銀行口座は締め日・支払日を詳細へ収め、既存の値とすべての設定は送信対象に残す', () => {
    const html = renderToString(
      h(AccountForm, {
        initial: account,
        submitLabel: '保存',
        action: async () => ({ error: null }),
      }),
    );
    expect(html.indexOf('詳細設定')).toBeLessThan(html.indexOf('name="closingDay"'));
    expect(html).toContain('name="paymentDay"');
    expect(html).toContain('value="25"');
    for (const name of [
      'name',
      'kind',
      'currentBalanceYen',
      'institutionName',
      'purpose',
      'note',
    ]) {
      expect(html).toContain(`name="${name}"`);
    }
  });

  it('カードでは締め日・支払日を最初から表示する', () => {
    const html = renderToString(
      h(AccountForm, {
        initial: { ...account, kind: 'credit_card' },
        submitLabel: '保存',
        action: async () => ({ error: null }),
      }),
    );
    expect(html.indexOf('name="closingDay"')).toBeLessThan(html.indexOf('<details'));
    expect(html).toContain('未払い残高をマイナス');
  });

  it('期間編集に別の保存操作はなく、編集全体の保存を案内する', () => {
    const html = renderToString(
      h(PlanPeriodForm, { periodStart: '2026-10-01', periodEnd: '2026-10-15', onChange: () => {} }),
    );
    expect(html).toContain('value="2026-10-01"');
    expect(html).toContain('まとめて保存');
    expect(html).not.toContain('<button');
  });

  it('提案の総額と保存を残し、カテゴリ配分と着地の調整だけを開閉する', () => {
    const html = renderToString(
      h(AllocationEditor, {
        compact: true,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-15',
        rows: [
          { genreId: 'a', genreName: '食費', baselineYen: 5000, note: '過去の支出', yen: 4000 },
        ],
        saveLabel: 'この目標で保存する',
        onSave: async () => ({ error: null }),
      }),
    );
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html.indexOf('目標の総額')).toBeLessThan(html.indexOf('<details'));
    expect(html.indexOf('この目標で保存する')).toBeGreaterThan(html.lastIndexOf('</details>'));
    expect(html).toContain('食費の目標額');
    expect(html).toContain('着地を見る');
  });
});
