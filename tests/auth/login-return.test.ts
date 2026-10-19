import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHookState } from '../helpers/hook-state';

const state = vi.hoisted(() => ({
  host: null as ReturnType<typeof createHookState> | null,
  search: new URLSearchParams(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useState']>) =>
    state.host!.hooks.useState(...args),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => state.search }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithPassword: state.signIn } }),
}));
vi.mock('../../app/login/actions', () => ({ signUpAction: state.signUp }));

import { LoginForm } from '../../app/login/login-form';

type ElementProps = {
  children?: ReactNode;
  returnTo?: string;
  onClick?: () => void;
  onSubmit?: (event: { preventDefault: () => void }) => Promise<void>;
};

function find(node: ReactNode, matches: (node: ReactElement<ElementProps>) => boolean) {
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!isValidElement<ElementProps>(current)) continue;
    if (matches(current)) return current;
    pending.push(current.props.children);
  }
  throw new Error('対象の要素がありません');
}

function screen() {
  state.host!.begin();
  return LoginForm();
}

function submit() {
  const page = screen();
  const formComponent = find(
    page,
    (node) => typeof node.type === 'function' && 'returnTo' in node.props,
  );
  const form = (formComponent.type as (props: ElementProps) => ReactElement<ElementProps>)(
    formComponent.props,
  );
  return form.props.onSubmit!({ preventDefault: vi.fn() });
}

beforeEach(() => {
  state.host = createHookState();
  state.search = new URLSearchParams();
  vi.clearAllMocks();
  state.signIn.mockResolvedValue({ error: null });
  state.signUp.mockResolvedValue({ error: null });
  vi.stubGlobal('window', { location: { replace: state.replace } });
});
afterEach(() => vi.unstubAllGlobals());

describe('ログイン成功後にカメラの入口へ戻る', () => {
  it('通常のログイン成功後はホームをページごと開く', async () => {
    await submit();
    expect(state.signIn).toHaveBeenCalledTimes(1);
    expect(state.replace).toHaveBeenCalledWith('/');
  });

  it.each(['/camera', '/camera?source=shortcut', '/spending?capture=1'])(
    'パスワード成功後は %s へ戻る',
    async (returnTo) => {
      state.search.set('returnTo', returnTo);
      await submit();
      expect(state.replace).toHaveBeenCalledWith(returnTo);
    },
  );

  it('外部 URL の指定ではホームを開く', async () => {
    state.search.set('returnTo', '//example.com');
    await submit();
    expect(state.replace).toHaveBeenCalledWith('/');
  });

  it('新規登録のあとも同じカメラの入口へ戻る', async () => {
    state.search.set('returnTo', '/camera');
    find(screen(), (node) => node.props.children === '新規登録').props.onClick!();
    await submit();
    expect(state.signUp).toHaveBeenCalledTimes(1);
    expect(state.signIn).toHaveBeenCalledTimes(1);
    expect(state.replace).toHaveBeenCalledWith('/camera');
  });

  it('ログインに失敗したら移動しない', async () => {
    state.search.set('returnTo', '/camera');
    state.signIn.mockResolvedValue({ error: { message: 'Invalid credentials' } });
    await submit();
    expect(state.replace).not.toHaveBeenCalled();
  });
});
