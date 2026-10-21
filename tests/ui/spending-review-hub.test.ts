import { isValidElement, type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MerchantNameReviewGroup } from '@/domain/merchant-name-review';
import type { ReceiptJob } from '@/features/import/receipt-queue';
import { EMPTY_FILTER } from '@/features/spending/views';
import { createHookState } from '../helpers/hook-state';
import { ledgerTx } from '../helpers/ledger';
import type { useSpendingMonth } from '../../app/(app)/spending/spending-month-provider';

const state = vi.hoisted(() => ({
  host: null as ReturnType<typeof createHookState> | null,
  month: null as ReturnType<typeof useSpendingMonth> | null,
  jobs: [] as ReceiptJob[],
  save: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useState']>) =>
    state.host!.hooks.useState(...args),
  useRef: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useRef']>) =>
    state.host!.hooks.useRef(...args),
  useMemo: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useMemo']>) =>
    state.host!.hooks.useMemo(...args),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('../../app/(app)/spending/spending-month-provider', () => ({
  useSpendingMonth: () => state.month!,
}));
vi.mock('@/features/import/receipt-queue', () => ({ useReceiptJobs: () => state.jobs }));
vi.mock('../../app/(app)/spending/merchant-name-actions', () => ({
  saveMerchantNameChangesAction: (...args: unknown[]) => state.save(...args),
}));
vi.mock('../../app/(app)/transactions/actions', () => ({
  recordGenreCorrectionAction: vi.fn(),
  resolveReconcileAction: vi.fn(),
  restoreRowFieldsAction: vi.fn(),
  updateTransactionAction: vi.fn(),
}));
vi.mock('../../app/(app)/transactions/receipt/receipt-results', () => ({
  ReceiptResults: () => null,
}));
vi.mock('../../app/(app)/transactions/duplicates/duplicate-list', () => ({
  DuplicateList: () => null,
}));
vi.mock('../../app/(app)/spending/pending-review-records', () => ({
  PendingReviewRecords: () => null,
}));
vi.mock('@/components/ui/bottom-sheet', () => ({
  BottomSheet: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? children : null,
  BottomSheetHeader: ({ children }: { children: ReactNode }) => children,
}));

import { AttentionCard, AttentionFixer } from '../../app/(app)/spending/attention-card';
import { ReviewHub } from '../../app/(app)/spending/review-hub';
import { ReceiptResults } from '../../app/(app)/transactions/receipt/receipt-results';
import { DuplicateList } from '../../app/(app)/transactions/duplicates/duplicate-list';
import {
  MerchantNameGroupEditor,
  MerchantNameResults,
} from '../../app/(app)/spending/merchant-name-review';
import { CaptureRow } from '../../app/(app)/spending/pending-receipt-rows';

const group: MerchantNameReviewGroup = {
  key: 'sugi',
  label: 'スキ薬局豊津店',
  branchName: null,
  reasons: ['normalization'],
  suggestedName: 'スギ薬局',
  suggestedBranch: '豊津店',
  entries: ['a', 'b'].map((suffix) => ({
    id: `00000000-0000-4000-8000-00000000000${suffix === 'a' ? '1' : '2'}`,
    merchantName: 'スキ薬局豊津店',
    description: `元の明細${suffix}`,
    branchName: null,
    updatedAt: '2026-10-18T01:00:00Z',
    occurredOn: '2026-10-16',
    amountYen: -1000,
  })),
};

type Props = {
  children?: ReactNode;
  open?: boolean;
  'aria-label'?: string;
  type?: string;
  checked?: boolean;
  value?: string;
  groups?: readonly MerchantNameReviewGroup[];
  href?: string;
  disabled?: boolean;
  queue?: unknown[];
  onSaved?: (ids: readonly string[]) => void;
  group?: MerchantNameReviewGroup;
  onClick?: () => void | Promise<void>;
  onChange?: (event: { target: { value: string } }) => void;
};
function nodes(tree: ReactNode) {
  const result: { type: unknown; props: Props }[] = [];
  const stack = [tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (!isValidElement<Props>(node)) continue;
    result.push(node);
    if (node.props.open !== false) stack.push(node.props.children);
  }
  return result;
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return isValidElement<Props>(node) ? text(node.props.children) : '';
}
function renderHub(props: Partial<ComponentProps<typeof AttentionCard>> = {}) {
  state.host!.begin();
  return AttentionCard({ hasGoal: true, ...props });
}
const EMPTY_DUPLICATES = {
  candidates: [],
  decided: [],
  storage: 'account' as const,
  hasBrowserDecisions: false,
};
function renderReview(props: Partial<ComponentProps<typeof ReviewHub>> = {}) {
  state.host!.begin();
  return ReviewHub({
    hasGoal: true,
    captures: [],
    records: [],
    duplicates: EMPTY_DUPLICATES,
    merchantNameGroups: [],
    merchantNameError: null,
    ...props,
  });
}
const sectionTitles = (tree: ReactNode) =>
  nodes(tree)
    .map((node) => (node.props as { title?: string }).title)
    .filter((title): title is string => typeof title === 'string');
function renderEditor() {
  state.host!.begin();
  return MerchantNameGroupEditor({ group, onSaved });
}
const onSaved = vi.fn();
const editorNodes = () => nodes(renderEditor());
const saveButton = () =>
  editorNodes().find(
    (node) => node.type === 'button' && text(node.props.children).includes('店名を保存'),
  )!.props;
const editorHtml = () => renderToStaticMarkup(renderEditor());

beforeEach(() => {
  state.host = createHookState();
  state.jobs = [];
  vi.clearAllMocks();
  state.save.mockResolvedValue({ updatedIds: [], failed: [], error: null });
  state.month = {
    transactions: [],
    captures: [],
    today: '2026-10-18',
    visibleMonth: '2026-10-01',
    currentMonthStart: '2026-10-01',
    genreBreakdown: [],
    genres: [],
    accounts: [],
    totals: {
      spentYen: 0,
      incomeYen: 0,
      scheduledYen: 0,
      specialYen: 0,
      daySpend: {},
      scheduledDaySpend: {},
    },
    isCurrentMonth: true,
    loading: false,
    error: null,
    goToMonth: vi.fn(),
    reloadVisibleMonth: vi.fn(),
    clearFilter: vi.fn(),
    setFilter: vi.fn(),
    filter: { ...EMPTY_FILTER },
  };
});

describe('明細の確認を1つの入口にまとめる(「確認が必要」1画面、ADR-127)', () => {
  it('未処理がなければ確認カードを表示しない', () => {
    expect(renderHub()).toBeNull();
  });
  it('カードは「確認が必要」の画面へ進む。数は全期間の入力・カテゴリ・重複・店名', () => {
    const props = {
      pendingInputCount: 2,
      pendingCategoryCount: 3,
      duplicateCount: 1,
      merchantNameGroups: [group],
    };
    const card = nodes(renderHub(props)).find((node) => node.props.href === '/spending/review')!;
    expect(card.props['aria-label']).toBe('確認が必要。8項目');
    expect(nodes(renderHub(props)).some((node) => node.type === 'button')).toBe(false);
  });
  it('別の月・口座・検索を選んでも全期間の未処理入口が残る', () => {
    state.month!.visibleMonth = '2026-08-01';
    state.month!.filter = { ...EMPTY_FILTER, accountId: 'other', search: '見つからない' };
    expect(
      nodes(renderHub({ pendingInputCount: 2 })).some(
        (node) => node.props.href === '/spending/review',
      ),
    ).toBe(true);
  });
  it('その画面で、読み取ったレシート・入力待ち・カテゴリ・店名・重複を片づける(別の画面へ飛ばさない)', () => {
    const tree = renderReview({
      captures: [{ id: 'cap' } as ComponentProps<typeof ReviewHub>['captures'][number]],
      records: [ledgerTx({ id: 'r', reviewStatus: 'pending' })],
      duplicates: { ...EMPTY_DUPLICATES, candidates: [{} as never] },
      merchantNameGroups: [group],
    });
    expect(sectionTitles(tree).sort()).toEqual(
      // 「AIでチェック」はいつでも出す(明細のタイトルの上から移した、ADR-131)
      [
        '入力待ちのレシート',
        'カテゴリの確認',
        '店名のゆれ・店名なし',
        '重複',
        'AIでチェック',
      ].sort(),
    );
    const all = nodes(tree);
    expect(all.some((node) => node.type === ReceiptResults)).toBe(true);
    expect(all.some((node) => node.type === CaptureRow)).toBe(true);
    expect(all.some((node) => node.type === DuplicateList)).toBe(true);
    expect(all.some((node) => node.type === MerchantNameResults)).toBe(true);
    for (const href of [
      '/spending?review=input',
      '/spending?review=category',
      '/transactions/duplicates',
      '/transactions/reconcile',
      '/transactions/receipt',
    ]) {
      expect(all.some((node) => node.props.href === href)).toBe(false);
    }
  });
  it('カテゴリと差額の既存修正キューを残す', () => {
    state.month!.transactions = [
      {
        ...ledgerTx({ id: 'x', genreId: null, genreName: null, reconcileDiffYen: 50 }),
        items: [],
        expenseSubtype: null,
      },
    ];
    nodes(renderReview()).find(
      (node) =>
        node.type === 'button' && text(node.props.children).includes('カテゴリ・差額を直す'),
    )!.props.onClick!();
    const fixer = nodes(renderReview()).find((node) => node.type === AttentionFixer)!;
    expect(fixer.props.open).toBe(true);
    expect(fixer.props.queue).toHaveLength(1);
  });
  it('サーバー入力待ちと同じジョブを重複して数えない', () => {
    state.month!.captures = [
      { id: 'capture' } as ReturnType<typeof useSpendingMonth>['captures'][number],
    ];
    state.jobs = [
      { id: 'covered', status: 'needs_input', captureId: 'capture' },
      { id: 'reading', status: 'reading' },
    ] as ReceiptJob[];
    const card = nodes(renderHub({ pendingInputCount: 1 })).find((node) =>
      node.props['aria-label']?.startsWith('確認が必要'),
    )!;
    expect(card.props['aria-label']).toBe('確認が必要。2項目');
  });
  it('候補読み込み失敗を未処理なしとして隠さない', () => {
    expect(renderHub({ merchantNameError: '店名を読み込めませんでした' })).not.toBeNull();
    const results = nodes(renderReview({ merchantNameError: '店名を読み込めませんでした' })).find(
      (node) => node.type === MerchantNameResults,
    )!;
    expect((results.props as { error?: string }).error).toBe('店名を読み込めませんでした');
  });
  it('何も残っていなければ、そう出す', () => {
    expect(renderToStaticMarkup(renderReview())).toContain('確認が必要なものはありません。');
  });
});

describe('店名候補は対象と名前を確認して保存する', () => {
  it('保存済みは元の候補だけ隠し、同じIDの新しい候補は隠さない', () => {
    function renderGroups(currentGroup: MerchantNameReviewGroup) {
      state.host!.begin();
      return nodes(MerchantNameResults({ groups: [currentGroup] }));
    }
    const editor = renderGroups(group).find((node) => node.type === MerchantNameGroupEditor)!;
    editor.props.onSaved!([group.entries[0]!.id]);
    const remaining = renderGroups(group).find((node) => node.type === MerchantNameGroupEditor)!;
    expect(remaining.props.group!.entries).toHaveLength(1);
    const changed = {
      ...group,
      entries: group.entries.map((entry) => ({ ...entry, updatedAt: '2026-10-18T02:00:00Z' })),
    };
    const latest = renderGroups(changed).find((node) => node.type === MerchantNameGroupEditor)!;
    expect(latest.props.group!.entries).toHaveLength(2);
  });
  it('候補は入力欄に示すだけで自動保存しない', () => {
    const input = editorNodes().find(
      (node) => node.type === 'input' && node.props.value === 'スギ薬局',
    )!;
    expect(input.props.value).toBe('スギ薬局');
    expect(state.save).not.toHaveBeenCalled();
    expect(editorHtml()).toContain('元の明細a');
  });
  it('選んだ明細だけを、編集した店名と支店名で保存する', async () => {
    const firstCheckbox = editorNodes()
      .filter((node) => node.type === 'input' && node.props.type === 'checkbox')
      .reverse()[0]!;
    firstCheckbox.props.onChange!({ target: { value: '' } });
    const inputs = editorNodes()
      .filter((node) => node.type === 'input' && node.props.type === 'text')
      .reverse();
    inputs[0]!.props.onChange!({ target: { value: ' 新しい店名 ' } });
    inputs[1]!.props.onChange!({ target: { value: '' } });
    await saveButton().onClick!();
    expect(state.save).toHaveBeenCalledWith({
      changes: [
        {
          snapshot: {
            id: group.entries[1]!.id,
            merchantName: group.entries[1]!.merchantName,
            description: group.entries[1]!.description,
            branchName: null,
            updatedAt: group.entries[1]!.updatedAt,
          },
          name: '新しい店名',
          branchName: null,
        },
      ],
    });
  });
  it('部分保存は成功した対象だけを消し、失敗した明細とエラーを残す', async () => {
    state.save.mockResolvedValue({
      updatedIds: [group.entries[0]!.id],
      failed: [{ id: group.entries[1]!.id, error: '明細が変更されています' }],
      error: null,
    });
    await saveButton().onClick!();
    expect(onSaved).toHaveBeenCalledWith([group.entries[0]!.id]);
    expect(editorHtml()).toContain('明細が変更されています');
    const checked = editorNodes().filter(
      (node) => node.type === 'input' && node.props.type === 'checkbox' && node.props.checked,
    );
    expect(checked).toHaveLength(1);
  });
  it('通信失敗でも入力と選択を残して再試行できる', async () => {
    state.save.mockRejectedValue(new Error('offline'));
    await saveButton().onClick!();
    expect(onSaved).not.toHaveBeenCalled();
    expect(editorHtml()).toContain('保存できなかった明細は残しています');
    expect(
      editorNodes().filter(
        (node) => node.type === 'input' && node.props.type === 'checkbox' && node.props.checked,
      ),
    ).toHaveLength(2);
    expect(saveButton().disabled).toBe(false);
  });
  it('空の名前と未選択は保存しない', async () => {
    const nameInput = editorNodes()
      .filter((node) => node.type === 'input' && node.props.type === 'text')
      .reverse()[0]!;
    nameInput.props.onChange!({ target: { value: ' ' } });
    expect(saveButton().disabled).toBe(true);
    await saveButton().onClick!();
    expect(state.save).not.toHaveBeenCalled();
  });
});
