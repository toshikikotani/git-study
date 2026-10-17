import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../app/(app)/transactions/duplicates/actions', () => ({
  ignoreTransactionAction: vi.fn(),
  saveDistinctPairAction: vi.fn(),
  undoDistinctPairAction: vi.fn(),
}));

import { DuplicateList } from '../../app/(app)/transactions/duplicates/duplicate-list';
import type {
  DuplicateCandidateView,
  DuplicateReviewView,
} from '@/features/transactions/duplicates-store';

const pair: DuplicateCandidateView = {
  key: 'a|b',
  signature: 'signature',
  dayGap: 1,
  earlier: {
    id: 'a',
    occurredOn: '2026-10-15',
    amountYen: 1200,
    label: 'レシート側',
    source: 'manual',
    accountName: '現金',
    receiptImageUrl: 'https://example.test/receipt.jpg',
  },
  later: {
    id: 'b',
    occurredOn: '2026-10-16',
    amountYen: 1200,
    label: 'メール側',
    source: 'gmail',
    accountName: 'カード',
    receiptImageUrl: null,
  },
};

const render = (overrides: Partial<DuplicateReviewView> = {}) =>
  renderToString(
    h(DuplicateList, {
      review: {
        candidates: [pair],
        decided: [],
        storage: 'account',
        hasBrowserDecisions: false,
        ...overrides,
      },
    }),
  ).replace(/<!-- -->/g, '');

describe('重複の確認画面', () => {
  it('片側を残す・両方残す・取り込み経路・写真比較を維持する', () => {
    const html = render();
    expect(html.match(/これを残す/g)).toHaveLength(2);
    expect(html).toContain('別の買い物なので、どちらも残す');
    expect(html).toContain('レシート・手入力');
    expect(html).toContain('メール');
    expect(html).toContain('https://example.test/receipt.jpg');
  });

  it('候補がなくても確認済みペアと写真・判断の取り消しを表示する', () => {
    const html = render({ candidates: [], decided: [pair] });
    expect(html).toContain('未確認の重複候補はありません');
    expect(html).toContain('確認済み 1組');
    expect(html).toContain('どちらの明細も集計に含めています');
    expect(html).toContain('判断を取り消して、もう一度確認する');
    expect(html).toContain('https://example.test/receipt.jpg');
  });

  it('端末保存の範囲と期限を明示する', () => {
    expect(render({ storage: 'browser' })).toContain('このブラウザに90日間保存');
    expect(render({ storage: 'browser' })).toContain('別の端末には反映されません');
    expect(render({ hasBrowserDecisions: true })).toContain('新しい判断はアカウントに保存');
  });
});
