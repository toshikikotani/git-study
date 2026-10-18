import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHookState } from '../helpers/hook-state';
import { ledgerTx } from '../helpers/ledger';
import { buildSplitPaymentRequest } from '@/domain/split-payment-request';

const state = vi.hoisted(() => ({ host: null as ReturnType<typeof createHookState> | null }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useState']>) =>
    state.host!.hooks.useState(...args),
  useRef: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useRef']>) =>
    state.host!.hooks.useRef(...args),
}));

import { SplitPaymentForm } from '../../app/(app)/spending/split-payment-sheet';

const transactions = [
  ledgerTx({ id: 'dinner', label: '夕食', amountYen: -1001 }),
  ledgerTx({ id: 'taxi', label: 'タクシー', amountYen: -1500 }),
];
let currentTransactions = transactions;
const onClose = vi.fn();
const writeText = vi.fn<(text: string) => Promise<void>>();

type NodeProps = {
  children?: ReactNode;
  id?: string;
  value?: string;
  disabled?: boolean;
  readOnly?: boolean;
  ref?: { current: HTMLTextAreaElement | null };
  onClick?: () => void | Promise<void>;
  onChange?: (event: { target: { value: string } }) => void;
};

function render() {
  state.host!.begin();
  const tree = SplitPaymentForm({ transactions: currentTransactions, onClose });
  state.host!.flush();
  return tree;
}

function nodes() {
  const pending: ReactNode[] = [render()];
  const result: { type: unknown; props: NodeProps }[] = [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (Array.isArray(node)) {
      pending.push(...node);
      continue;
    }
    if (!isValidElement<NodeProps>(node)) continue;
    result.push(node);
    pending.push(node.props.children);
  }
  return result;
}

const html = () => renderToStaticMarkup(render());
const button = (text: string) =>
  nodes().find((node) => node.type === 'button' && node.props.children === text)!.props;
const input = () => nodes().find((node) => node.type === 'input')!.props;
const preview = () => nodes().find((node) => node.type === 'textarea')!.props;
const changePeople = (value: string) => input().onChange!({ target: { value } });

beforeEach(() => {
  state.host = createHookState();
  currentTransactions = transactions;
  vi.clearAllMocks();
  writeText.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
});
afterEach(() => vi.unstubAllGlobals());

describe('割り勘の文面を確認してコピーする', () => {
  it('初期値は自分を含む2人で、明示的に押してから全文のコピー成功を知らせる', async () => {
    expect(input().value).toBe('2');
    expect(html()).toContain('相手1人あたり');
    expect(html()).toContain('1,250円');
    expect(html()).toContain('自分の負担 1,251円');
    expect(html()).not.toContain('コピーしました');
    expect(writeText).not.toHaveBeenCalled();

    await button('コピー').onClick!();

    expect(writeText).toHaveBeenCalledWith(buildSplitPaymentRequest(transactions, 2).message);
    expect(html()).toContain('コピーしました');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('コピーを拒否されても全文と手動選択を残し、再試行できる', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    await button('コピー').onClick!();

    expect(html()).toContain('コピーできませんでした');
    expect(html()).not.toContain('コピーしました');
    expect(preview().readOnly).toBe(true);
    expect(preview().value).toBe(buildSplitPaymentRequest(transactions, 2).message);

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

  it('Clipboard APIがないブラウザでも全文を手動コピーできる', async () => {
    vi.stubGlobal('navigator', {});
    await button('コピー').onClick!();

    expect(html()).toContain('このブラウザではコピーできません');
    expect(preview().value).toBe(buildSplitPaymentRequest(transactions, 2).message);
    expect(button('文面を選択').disabled).not.toBe(true);
    expect(html()).not.toContain('コピーしました');
  });

  it('人数を変えると成功表示を消し、再計算した文面をコピーする', async () => {
    await button('コピー').onClick!();
    changePeople('3');

    expect(html()).not.toContain('コピーしました');
    expect(preview().value).toBe(buildSplitPaymentRequest(transactions, 3).message);
    await button('コピー').onClick!();
    expect(writeText).toHaveBeenLastCalledWith(buildSplitPaymentRequest(transactions, 3).message);
    expect(html()).toContain('コピーしました');
  });

  it('コピー中に人数を変えた場合、古い文面の完了を成功として表示しない', async () => {
    let resolveCopy!: () => void;
    writeText.mockReturnValueOnce(new Promise<void>((resolve) => (resolveCopy = resolve)));
    const copying = button('コピー').onClick!();
    expect(button('コピー中…').disabled).toBe(true);

    changePeople('3');
    resolveCopy();
    await copying;

    expect(html()).not.toContain('コピーしました');
    expect(preview().value).toBe(buildSplitPaymentRequest(transactions, 3).message);
  });

  it.each(['', '1', '1.5', '9007199254740992', '10000'])(
    '無効な人数 %j では請求文を生成せずコピーを止める',
    async (value) => {
      changePeople(value);
      expect(html()).toContain('role="alert"');
      expect(nodes().some((node) => node.type === 'textarea')).toBe(false);
      expect(button('コピー').disabled).toBe(true);
      await button('コピー').onClick!();
      expect(writeText).not.toHaveBeenCalled();
    },
  );

  it('戻る操作ではコピーせず、元の選択画面へ戻す', () => {
    button('戻る').onClick!();
    expect(onClose).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('開いている間に選択明細がなくなれば、古い請求文を残さずコピーを止める', async () => {
    await button('コピー').onClick!();
    currentTransactions = [];

    expect(html()).toContain('割り勘にする明細を選んでください');
    expect(html()).not.toContain('コピーしました');
    expect(nodes().some((node) => node.type === 'textarea')).toBe(false);
    expect(button('コピー').disabled).toBe(true);
  });
});
