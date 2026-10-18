import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildLedgerSelectionText } from '@/domain/ledger-selection';
import { createHookState } from '../helpers/hook-state';
import { ledgerTx } from '../helpers/ledger';

const state = vi.hoisted(() => ({ host: null as ReturnType<typeof createHookState> | null }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useState']>) =>
    state.host!.hooks.useState(...args),
  useRef: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useRef']>) =>
    state.host!.hooks.useRef(...args),
}));

import { SelectionCopyForm } from '../../app/(app)/spending/selection-copy-sheet';

const initialTransactions = [
  ledgerTx({ id: 'dinner', label: '夕食', amountYen: -1001 }),
  ledgerTx({ id: 'refund', label: '返品', amountYen: 500, kind: 'refund' }),
];
let transactions = initialTransactions;
const onClose = vi.fn();
const writeText = vi.fn<(text: string) => Promise<void>>();

type NodeProps = {
  children?: ReactNode;
  value?: string;
  disabled?: boolean;
  readOnly?: boolean;
  ref?: { current: HTMLTextAreaElement | null };
  onClick?: () => void | Promise<void>;
};

function render() {
  state.host!.begin();
  const tree = SelectionCopyForm({ transactions, onClose });
  state.host!.flush();
  return tree;
}

function nodes() {
  const pending: ReactNode[] = [render()];
  const found: { type: unknown; props: NodeProps }[] = [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (Array.isArray(node)) {
      pending.push(...node);
      continue;
    }
    if (!isValidElement<NodeProps>(node)) continue;
    found.push(node);
    pending.push(node.props.children);
  }
  return found;
}

const html = () => renderToStaticMarkup(render());
const button = (name: string) =>
  nodes().find((node) => node.type === 'button' && node.props.children === name)!.props;
const preview = () => nodes().find((node) => node.type === 'textarea')!.props;

beforeEach(() => {
  state.host = createHookState();
  transactions = initialTransactions;
  vi.clearAllMocks();
  writeText.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
});
afterEach(() => vi.unstubAllGlobals());

describe('明細の内容を確認してコピーする', () => {
  it('読み取り専用の全文を示し、ボタンを押すまでコピーしない', () => {
    expect(preview().readOnly).toBe(true);
    expect(preview().value).toBe(buildLedgerSelectionText(transactions));
    expect(writeText).not.toHaveBeenCalled();
    expect(html()).not.toContain('コピーしました');
  });

  it('コピーの完了を待ってから成功を表示する', async () => {
    let resolve!: () => void;
    writeText.mockReturnValueOnce(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    const copying = button('コピー').onClick!();
    expect(writeText).toHaveBeenCalledWith(buildLedgerSelectionText(transactions));
    expect(button('コピー中…').disabled).toBe(true);
    expect(html()).not.toContain('コピーしました');
    resolve();
    await copying;
    expect(html()).toContain('コピーしました');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('拒否されても全文と手動選択を残し、再試行できる', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    await button('コピー').onClick!();
    expect(html()).toContain('コピーできませんでした');
    expect(html()).not.toContain('コピーしました');
    expect(preview().value).toBe(buildLedgerSelectionText(transactions));
    const field = {
      value: preview().value!,
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    };
    preview().ref!.current = field as unknown as HTMLTextAreaElement;
    button('文面を選択').onClick!();
    expect(field.focus).toHaveBeenCalledOnce();
    expect(field.select).toHaveBeenCalledOnce();
    expect(field.setSelectionRange).toHaveBeenCalledWith(0, field.value.length);
    await button('コピー').onClick!();
    expect(html()).toContain('コピーしました');
    expect(html()).not.toContain('コピーできませんでした');
  });

  it('Clipboard APIがなくても文面を手動コピーできる', async () => {
    vi.stubGlobal('navigator', {});
    await button('コピー').onClick!();
    expect(html()).toContain('このブラウザではコピーできません');
    expect(preview().value).toBe(buildLedgerSelectionText(transactions));
    expect(button('文面を選択').disabled).not.toBe(true);
  });

  it('別の明細へ変わったら、同じ文面でも過去の成功を表示しない', async () => {
    await button('コピー').onClick!();
    transactions = transactions.map((entry) => ({ ...entry, id: `other-${entry.id}` }));
    expect(preview().value).toBe(buildLedgerSelectionText(initialTransactions));
    expect(html()).not.toContain('コピーしました');
  });

  it.each(['success', 'failure'])(
    '選択変更後に古いコピーが%sで終わっても現在の結果にしない',
    async (result) => {
      let finish!: () => void;
      writeText.mockReturnValueOnce(
        new Promise<void>((resolve, reject) => {
          finish = () => (result === 'success' ? resolve() : reject(new Error('denied')));
        }),
      );
      const copying = button('コピー').onClick!();
      transactions = [ledgerTx({ id: 'new', label: '次の買い物' })];
      expect(preview().value).toContain('次の買い物');
      finish();
      await copying;
      expect(html()).not.toContain('コピーしました');
      expect(html()).not.toContain('コピーできませんでした');
    },
  );

  it('選択がなくなれば過去の文面を消してコピーを止める', async () => {
    await button('コピー').onClick!();
    transactions = [];
    expect(html()).toContain('コピーする明細を選んでください');
    expect(html()).not.toContain('コピーしました');
    expect(nodes().some((node) => node.type === 'textarea')).toBe(false);
    expect(button('コピー').disabled).toBe(true);
    await button('コピー').onClick!();
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('戻ると元の選択へ戻り、コピーしない', () => {
    button('戻る').onClick!();
    expect(onClose).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
  });
});
