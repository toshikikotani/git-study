'use client';

import { useOptimistic, useState, useTransition } from 'react';

import { Switch } from '@/components/ui/switch';
import { updateAiSettingsAction } from './ai-actions';

/**
 * 設定の画面の「AI機能」の行(提案書「AI機能は設定の1行のスイッチ」、ADR-127)。押したらそのまま保存する
 * (もとは別の画面で「保存する」を押していた)。スイッチは先に動かし、保存できなかったら元に戻して知らせる。
 * オフにすると、AIを呼ぶ機能はAIを使わない表示に切り替わる(src/lib/ai-gateway/settings.ts の
 * isAiEnabled())。記録・集計・目標はAIに依存しない。
 */
export function AiSwitch({ aiEnabled }: { aiEnabled: boolean }) {
  const [checked, setChecked] = useOptimistic(aiEnabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const change = (next: boolean) =>
    startTransition(async () => {
      setChecked(next);
      const form = new FormData();
      if (next) form.set('aiEnabled', 'on');
      try {
        const result = await updateAiSettingsAction({ error: null, saved: false }, form);
        setError(result.error);
      } catch {
        setError('保存できませんでした。通信を確かめて、もう一度押してください。');
      }
    });

  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
      <span className="flex min-w-0 flex-col">
        <span className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
          AI機能
        </span>
        <span
          role={error ? 'alert' : undefined}
          className="text-[12px]"
          style={{ color: error ? 'var(--over)' : 'var(--ink-muted)' }}
        >
          {pending
            ? '保存しています…'
            : (error ??
              'レシートの読み取り・カテゴリの案・AIの気づき・相談。オフでも記録と集計は使えます')}
        </span>
      </span>
      <Switch checked={checked} onChange={change} label="AI機能を使う" />
    </div>
  );
}
