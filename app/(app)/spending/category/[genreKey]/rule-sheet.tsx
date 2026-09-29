'use client';

import { useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Yen } from '@/components/ui/money';
import { describeRule, type RuleScope, type RuleSuggestion } from '@/domain/rule-match';
import { hapticFor } from '@/lib/haptics';
import { pushUndo } from '@/lib/undo';
import { previewRuleAction, saveRuleAction, undoRuleAction, type RuleMatchRow } from '../actions';

/**
 * カテゴリを変えた直後の、分類ルールの提案。
 *   1. 「今後も○○の△△は□□にしますか?」 → ルールにする / しない
 *   2. 保存する前の事前確認:「このルールに一致する過去の取引が12件あります」と対象の一覧を見せ、
 *      「今後のみ適用」「過去の12件にも適用」を選ばせる。
 * 保存したら成功の触覚を返し、元に戻せる(ルールを消し、過去に当てた分も戻す)。
 */
export function RuleSheet({
  suggestion,
  toGenre,
  onClose,
  onApplied,
}: {
  suggestion: RuleSuggestion | null;
  toGenre: { id: string; name: string } | null;
  onClose: () => void;
  /** 過去の取引に当てたとき(画面の状態にも反映する。戻り値は取り消しで呼ぶ)。 */
  onApplied: (scope: RuleScope, toGenreId: string, ids: ReadonlySet<string>) => () => void;
}) {
  const open = suggestion !== null && toGenre !== null;
  return (
    <BottomSheet open={open} onClose={onClose} role="dialog">
      {suggestion && toGenre ? (
        <RuleFlow
          key={`${suggestion.question}:${toGenre.id}`}
          suggestion={suggestion}
          toGenre={toGenre}
          onClose={onClose}
          onApplied={onApplied}
        />
      ) : null}
    </BottomSheet>
  );
}

export function RuleFlow({
  suggestion,
  toGenre,
  onClose,
  onApplied,
}: {
  suggestion: RuleSuggestion;
  toGenre: { id: string; name: string };
  onClose: () => void;
  onApplied: (scope: RuleScope, toGenreId: string, ids: ReadonlySet<string>) => () => void;
}) {
  const [step, setStep] = useState<'ask' | 'preview'>('ask');
  const [matches, setMatches] = useState<RuleMatchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPreview = async () => {
    setBusy(true);
    setError(null);
    const r = await previewRuleAction({ scope: suggestion.scope, toGenreId: toGenre.id });
    setBusy(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    setMatches(r.matches);
    setStep('preview');
  };

  const save = async (applyToPast: boolean) => {
    setBusy(true);
    setError(null);
    const r = await saveRuleAction({
      scope: suggestion.scope,
      toGenreId: toGenre.id,
      applyToPast,
    });
    setBusy(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    hapticFor('ruleSaved');
    const undoLocal = applyToPast
      ? onApplied(suggestion.scope, toGenre.id, new Set(matches.map((m) => m.id)))
      : () => {};
    const previous = r.previous;
    pushUndo(
      applyToPast && r.applied > 0
        ? `ルールを保存し、過去の${r.applied}件にも適用しました`
        : 'ルールを保存しました(今後のみ適用)',
      async () => {
        const u = await undoRuleAction({
          scope: suggestion.scope,
          ...(previous ? { previous } : {}),
        });
        if (u.error) return u.error;
        undoLocal();
        return null;
      },
    );
    onClose();
  };

  return (
    <div className="space-y-3 px-3 pb-3">
      {step === 'ask' ? (
        <>
          <p className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
            {suggestion.question}
          </p>
          <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            ルールにすると、次からのレシートは自動で{toGenre.name}に入ります。保存の前に、
            一致する過去の取引を確認できます。
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="min-h-11 flex-1 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
            >
              しない
            </button>
            <button
              type="button"
              onClick={() => void openPreview()}
              disabled={busy}
              className="min-h-11 flex-1 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: 'var(--action)', color: 'var(--on-action)' }}
            >
              {busy ? '調べています…' : 'ルールにする'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
            {describeRule(suggestion.scope)} → {toGenre.name}
          </p>
          <p role="status" className="text-sm" style={{ color: 'var(--ink)' }}>
            このルールに一致する過去の取引が{matches.length}件あります
          </p>
          {matches.length > 0 ? (
            <ul
              aria-label="一致する過去の取引"
              className="divider-list max-h-56 overflow-y-auto rounded-xl"
              style={{ background: 'var(--surface-raised)' }}
            >
              {matches.map((m) => (
                <li
                  key={m.id}
                  className="flex min-h-11 items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="min-w-0 text-sm break-words" style={{ color: 'var(--ink)' }}>
                    <span className="tabular text-xs" style={{ color: 'var(--ink-secondary)' }}>
                      {m.occurredOn.slice(5).replace('-', '/')}
                    </span>{' '}
                    {m.label}
                    <span className="ml-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
                      {m.genreName ?? '未分類'}
                    </span>
                  </span>
                  <Yen value={-m.amountYen} className="shrink-0 text-sm" />
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void save(false)}
              disabled={busy}
              className="min-h-11 flex-1 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
            >
              今後のみ適用
            </button>
            <button
              type="button"
              onClick={() => void save(true)}
              disabled={busy || matches.length === 0}
              className="min-h-11 flex-1 rounded-xl text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--action)', color: 'var(--on-action)' }}
            >
              過去の{matches.length}件にも適用
            </button>
          </div>
        </>
      )}
      {error ? (
        <p role="alert" className="text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
