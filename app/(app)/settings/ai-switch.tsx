'use client';

import { useActionState, useRef } from 'react';

import { updateAiSettingsAction, type AiSettingsFormState } from './ai-actions';

const INITIAL_STATE: AiSettingsFormState = { error: null, saved: false };

/**
 * 設定の画面の「AI機能」の行(提案書「AI機能は設定の1行のスイッチ」、ADR-127)。押したらそのまま保存する
 * (もとは別の画面で「保存する」を押していた)。オフにすると、AIを呼ぶ機能はAIを使わない表示に切り替わる
 * (src/lib/ai-gateway/settings.ts の isAiEnabled())。記録・集計・目標はAIに依存しない。
 */
export function AiSwitch({ aiEnabled }: { aiEnabled: boolean }) {
  const [state, formAction, pending] = useActionState(updateAiSettingsAction, INITIAL_STATE);
  const form = useRef<HTMLFormElement>(null);

  return (
    <form ref={form} action={formAction}>
      <label className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-medium" style={{ color: 'var(--ink)' }}>
            AI機能
          </span>
          <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            {pending
              ? '保存しています…'
              : state.error
                ? state.error
                : 'レシートの読み取り・カテゴリの案・AIの気づき・相談。オフでも記録と集計は使えます'}
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          name="aiEnabled"
          defaultChecked={aiEnabled}
          aria-label="AI機能を使う"
          onChange={() => form.current?.requestSubmit()}
          className="size-6 shrink-0"
          style={{ accentColor: 'var(--action)' }}
        />
      </label>
    </form>
  );
}
