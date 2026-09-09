'use client';

import { useState } from 'react';

import { Card } from '@/components/ui/card';
import type { Account } from '@/features/accounts/store';
import { updateAccountAction } from './actions';
import { AccountForm } from './account-form';
import { ACCOUNT_KIND_LABELS, ACCOUNT_PURPOSE_LABELS } from './kind-labels';

/** 一覧の1件。読み取り表示と編集フォームをこの中で切り替える。 */
export function AccountRow({ account }: { account: Account }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <Card>
        <AccountForm
          action={updateAccountAction.bind(null, account.id)}
          initial={account}
          submitLabel="更新する"
          onDone={() => setEditing(false)}
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            {account.name}
          </h3>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {account.institutionName ? `${account.institutionName} ・ ` : ''}
            {ACCOUNT_KIND_LABELS[account.kind]} ・ {ACCOUNT_PURPOSE_LABELS[account.purpose]}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 text-xs font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          編集
        </button>
      </div>

      {account.closingDay !== null || account.paymentDay !== null ? (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          {account.closingDay !== null ? (
            <Stat label="締め日" value={`毎月${account.closingDay}日`} />
          ) : null}
          {account.paymentDay !== null ? (
            <Stat label="支払日" value={`毎月${account.paymentDay}日`} />
          ) : null}
        </dl>
      ) : null}

      {account.note ? (
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {account.note}
        </p>
      ) : null}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="inline" style={{ color: 'var(--ink-muted)' }}>
        {label}{' '}
      </dt>
      <dd className="tabular inline font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {value}
      </dd>
    </div>
  );
}
