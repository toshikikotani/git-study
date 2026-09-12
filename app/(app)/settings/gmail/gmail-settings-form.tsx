'use client';

import { useActionState } from 'react';

import { updateGmailSettingsAction, type GmailSettingsFormState } from './actions';
import type { GmailSettings } from '@/features/settings/gmail-store';

const INITIAL_STATE: GmailSettingsFormState = { error: null, saved: false };

export function GmailSettingsForm({ settings }: { settings: GmailSettings }) {
  const [state, formAction, pending] = useActionState(updateGmailSettingsAction, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-4">
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
          自動取得を有効にする
        </span>
        <input
          type="checkbox"
          name="gmailEnabled"
          defaultChecked={settings.gmailEnabled}
          className="size-5"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
          差出人ドメイン(1行に1つ。空にすると全件が対象になります)
        </span>
        <textarea
          name="gmailFromAddresses"
          rows={5}
          defaultValue={settings.gmailFromAddresses.join('\n')}
          placeholder={'rakuten-card.co.jp\nsmbc-card.com'}
          className="w-full rounded-2xl px-4 py-3 font-mono text-xs outline-none"
          style={{
            background: 'var(--surface)',
            color: 'var(--ink)',
            boxShadow: 'var(--card-shadow)',
          }}
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
          1回の取得件数上限(1〜1000)
        </span>
        <input
          type="number"
          name="gmailFetchLimit"
          min={1}
          max={1000}
          defaultValue={settings.gmailFetchLimit}
          className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
          style={{
            background: 'var(--surface)',
            color: 'var(--ink)',
            boxShadow: 'var(--card-shadow)',
          }}
        />
      </label>

      {state.error ? (
        <p className="text-xs" style={{ color: 'var(--over)' }}>
          {state.error}
        </p>
      ) : null}
      {state.saved ? (
        <p className="text-xs" style={{ color: 'var(--income)' }}>
          保存しました
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl py-3 text-sm font-medium text-white disabled:opacity-50"
        style={{ background: 'var(--accent)' }}
      >
        {pending ? '保存しています…' : '保存する'}
      </button>
    </form>
  );
}
