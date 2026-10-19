import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHookState } from '../helpers/hook-state';

const state = vi.hoisted(() => ({ host: null as ReturnType<typeof createHookState> | null }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useState']>) =>
    state.host!.hooks.useState(...args),
  useRef: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useRef']>) =>
    state.host!.hooks.useRef(...args),
}));

import { CameraLink } from '@/components/receipt/camera-link';

type Props = {
  children?: ReactNode;
  disabled?: boolean;
  value?: string;
  readOnly?: boolean;
  ref?: { current: HTMLInputElement | null };
  onClick?: () => void;
};
const writeText = vi.fn<(text: string) => Promise<void>>();

function render() {
  state.host!.begin();
  return CameraLink();
}
function nodes() {
  const pending: ReactNode[] = [render()];
  const found: { type: unknown; props: Props }[] = [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (Array.isArray(node)) pending.push(...node);
    else if (isValidElement<Props>(node)) {
      found.push(node);
      pending.push(node.props.children);
    }
  }
  return found;
}
const html = () => renderToStaticMarkup(render());
const copyButton = () =>
  nodes().find((node) => node.type === 'button' && node.props.disabled !== undefined)!.props;
const input = () => nodes().find((node) => node.type === 'input')!.props;
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  state.host = createHookState();
  vi.clearAllMocks();
  writeText.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  vi.stubGlobal('window', {
    location: {
      origin: 'https://household.example',
      href: 'https://household.example/transactions?token=private#receipt',
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('カメラの固定URLをコピーする', () => {
  it('ページのクエリやトークンを含めず、同じ配信元の /camera をコピーする', async () => {
    expect(writeText).not.toHaveBeenCalled();
    copyButton().onClick!();
    await settle();
    expect(writeText).toHaveBeenCalledExactlyOnceWith('https://household.example/camera');
    expect(html()).toContain('コピーしました');
    expect(html()).not.toContain('private');
  });

  it('コピー完了前には成功を出さず、再描画前の連打も一回にまとめる', async () => {
    let finish!: () => void;
    writeText.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
    const original = copyButton();
    original.onClick!();
    original.onClick!();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(copyButton().disabled).toBe(true);
    expect(html()).not.toContain('コピーしました');
    finish();
    await settle();
    expect(copyButton().disabled).toBe(false);
    expect(html()).toContain('コピーしました');
  });

  it.each(['denied', 'unavailable'])('コピー不可 (%s) なら選択できるURLを残す', async (reason) => {
    if (reason === 'denied') writeText.mockRejectedValueOnce(new Error('denied'));
    else vi.stubGlobal('navigator', {});
    copyButton().onClick!();
    await settle();
    expect(html()).toContain('コピーできませんでした');
    expect(html()).not.toContain('コピーしました');
    expect(input().value).toBe('https://household.example/camera');
    expect(input().readOnly).toBe(true);
    const field = {
      value: input().value!,
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    };
    input().ref!.current = field as unknown as HTMLInputElement;
    nodes().find((node) => node.props.children === 'URLを選択')!.props.onClick!();
    expect(field.focus).toHaveBeenCalledOnce();
    expect(field.select).toHaveBeenCalledOnce();
    expect(field.setSelectionRange).toHaveBeenCalledWith(0, field.value.length);
  });

  it('拒否の後にコピーし直せる', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    copyButton().onClick!();
    await settle();
    copyButton().onClick!();
    await settle();
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(html()).toContain('コピーしました');
    expect(html()).not.toContain('コピーできませんでした');
    expect(nodes().some((node) => node.type === 'input')).toBe(false);
  });
});
