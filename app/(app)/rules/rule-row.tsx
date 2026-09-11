'use client';

import { useState } from 'react';

import { Card } from '@/components/ui/card';
import type { ClassificationRuleSummary } from '@/features/classification/store';
import {
  deleteRuleAction,
  moveRuleDownAction,
  moveRuleUpAction,
  setRuleActiveAction,
} from './actions';

const MATCH_TYPE_LABEL: Record<ClassificationRuleSummary['matchType'], string> = {
  keyword: 'キーワード',
  regex: '正規表現',
  exact: '完全一致',
  amount_range: '金額の範囲',
  merchant: '店舗名',
};

/**
 * 分類ルール一覧の1件(M2-6)。優先度の入れ替え・有効無効・削除はどれも
 * 1タップの操作なので、確認待ちキュー(M2-5)の学習ルール作成と同じく
 * フォームを介さず直接 Server Action を呼ぶ。
 */
export function RuleRow({
  rule,
  isFirst,
  isLast,
}: {
  rule: ClassificationRuleSummary;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<{ error: string | null }>) => {
    setPending(true);
    const result = await action();
    setError(result.error);
    setPending(false);
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-medium"
            style={{ color: rule.isActive ? 'var(--ink)' : 'var(--ink-muted)' }}
          >
            {rule.name}
            {rule.isLearned ? (
              <span
                className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
              >
                学習済み
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {MATCH_TYPE_LABEL[rule.matchType]}
            {rule.pattern ? `「${rule.pattern}」` : ''}
            {rule.categoryName ? ` → ${rule.categoryName}` : ''}
          </p>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            優先度 {rule.priority} ・ ヒット {rule.hitCount} 件
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex gap-1">
            <button
              type="button"
              disabled={pending || isFirst}
              onClick={() => void run(() => moveRuleUpAction(rule.id))}
              className="rounded-full px-2 py-1 text-xs disabled:opacity-30"
              style={{ color: 'var(--ink-muted)', border: '1px solid var(--hairline)' }}
              aria-label="優先度を上げる"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={pending || isLast}
              onClick={() => void run(() => moveRuleDownAction(rule.id))}
              className="rounded-full px-2 py-1 text-xs disabled:opacity-30"
              style={{ color: 'var(--ink-muted)', border: '1px solid var(--hairline)' }}
              aria-label="優先度を下げる"
            >
              ↓
            </button>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => void run(() => setRuleActiveAction(rule.id, !rule.isActive))}
            className="text-xs font-semibold disabled:opacity-40"
            style={{ color: rule.isActive ? 'var(--ink-muted)' : 'var(--accent)' }}
          >
            {rule.isActive ? '無効化' : '有効化'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => void run(() => deleteRuleAction(rule.id))}
            className="text-xs font-semibold disabled:opacity-40"
            style={{ color: 'var(--over)' }}
          >
            削除
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-2 text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </Card>
  );
}
