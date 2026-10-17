'use client';

import { useCallback, useEffect, useId, useState } from 'react';

import type { AccountOption } from '@/features/transactions/accounts-client';
import { ensureDefaultAccountAction } from '../accounts/actions';

/** Keep account setup beside the draft, including a retry when fetching failed. */
export function useInputAccount(
  initialAccountId = '',
  { autoCreateDefault = false }: { autoCreateDefault?: boolean } = {},
) {
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null);
  const [accountId, setAccountId] = useState(initialAccountId);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createDefault = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const result = await ensureDefaultAccountAction();
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setAccounts((current) =>
        current?.some((account) => account.id === result.account.id)
          ? current
          : [...(current ?? []), result.account],
      );
      setAccountId(result.account.id);
    } catch {
      setError('口座を用意できませんでした。もう一度お試しください。');
    } finally {
      setCreating(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/accounts');
      if (!response.ok) throw new Error('accounts unavailable');
      const data = (await response.json()) as { accounts: AccountOption[] };
      if (!Array.isArray(data.accounts)) throw new Error('accounts unavailable');
      setAccounts(data.accounts);
      setAccountId((current) =>
        data.accounts.some((account) => account.id === current)
          ? current
          : (data.accounts[0]?.id ?? ''),
      );
      if (autoCreateDefault && data.accounts.length === 0) await createDefault();
    } catch {
      setAccounts(null);
      setError('口座を読み込めませんでした。入力内容はそのまま再試行できます。');
    } finally {
      setLoading(false);
    }
  }, [autoCreateDefault, createDefault]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Load accounts from the external API.
    void load();
  }, [load]);

  return {
    accounts,
    accountId,
    setAccountId,
    selectedAccount: accounts?.find((account) => account.id === accountId) ?? null,
    loading,
    creating,
    error,
    retry: () => void load(),
    createDefault,
  };
}

export function InputAccountSelector({
  inputAccount,
  onChange,
  allowCreateDefault = true,
}: {
  inputAccount: ReturnType<typeof useInputAccount>;
  onChange?: (accountId: string) => void;
  allowCreateDefault?: boolean;
}) {
  const id = useId();
  const { accounts, accountId, loading, creating, error } = inputAccount;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
        口座
      </label>
      {loading ? (
        <p role="status" className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          口座を読み込んでいます…
        </p>
      ) : accounts === null ? (
        <button
          type="button"
          onClick={inputAccount.retry}
          className="min-h-11 block rounded-xl px-3 text-sm font-semibold"
          style={{ background: 'var(--plane)', color: 'var(--accent)' }}
        >
          口座を再読み込みする
        </button>
      ) : accounts.length === 0 ? (
        <div className="space-y-2">
          <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            口座がまだありません。入力内容を残したまま、この場で用意できます。
          </p>
          {allowCreateDefault ? (
            <button
              type="button"
              onClick={() => void inputAccount.createDefault()}
              disabled={creating}
              className="min-h-11 rounded-xl px-3 text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
            >
              {creating ? '口座を用意しています…' : '現金の口座を作って続ける'}
            </button>
          ) : null}
        </div>
      ) : accounts.length === 1 ? (
        <p className="text-sm" style={{ color: 'var(--ink)' }}>
          {accounts[0]!.name}
        </p>
      ) : (
        <select
          id={id}
          value={accountId}
          onChange={(event) => {
            inputAccount.setAccountId(event.target.value);
            onChange?.(event.target.value);
          }}
          className="min-h-11 w-full rounded-xl px-3 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      )}
      {error ? (
        <p role="alert" className="text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
