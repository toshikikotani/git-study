'use client';

import { useState, useTransition } from 'react';

import { formatYen } from '@/domain/money';
import type {
  DuplicateCandidateView,
  DuplicateSideView,
  DuplicateReviewView,
} from '@/features/transactions/duplicates-store';
import { formatDateJa } from '@/lib/date';
import { ignoreTransactionAction, saveDistinctPairAction, undoDistinctPairAction } from './actions';

/** 取り込み経路の表示名。どちらを残すかの判断材料になるので必ず出す。 */
const SOURCE_LABEL: Record<DuplicateSideView['source'], string> = {
  csv: 'CSV',
  gmail: 'メール',
  manual: 'レシート・手入力',
  api: 'API',
};

/**
 * 重複候補のペアを1組ずつ処理する(本人発案)。
 *
 * 「同じ買い物か」は本人にしか判断できないため、こちらからは決めない。
 * 残す方を押してもらい、押されなかった側を ignored にする。違うものなら
 * 「別の買い物」はペアへの判断を保存する(どちらも集計に残る)。
 */
export function DuplicateList({ review }: { review: DuplicateReviewView }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { candidates, decided } = review;

  const run = (action: () => Promise<{ error: string | null }>) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) setError(result.error);
      } catch {
        setError('通信できませんでした。接続を確認してもう一度お試しください。');
      }
    });
  };

  const keep = (candidate: DuplicateCandidateView, keepId: string) => {
    const ignoreId = candidate.earlier.id === keepId ? candidate.later.id : candidate.earlier.id;
    run(() => ignoreTransactionAction(ignoreId));
  };

  return (
    <div className="space-y-3">
      {review.storage === 'browser' ? (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          「別の買い物」の判断は、このブラウザに90日間保存します。別の端末には反映されません。
        </p>
      ) : review.hasBrowserDecisions ? (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          このブラウザにだけ保存されている判断も表示しています（保存から90日間）。新しい判断はアカウントに保存します。
        </p>
      ) : null}
      {error !== null ? (
        <p role="alert" className="text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
      {pending ? (
        <p role="status" className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          保存しています…
        </p>
      ) : null}
      {candidates.length === 0 ? (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          未確認の重複候補はありません。
        </p>
      ) : null}
      {candidates.map((candidate) => (
        <div
          key={candidate.key}
          className="glass rounded-2xl p-4"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              {formatYen(candidate.earlier.amountYen, { sign: 'never' })} が2件
            </p>
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              {candidate.dayGap === 0 ? '同じ日' : `${candidate.dayGap}日違い`}
            </p>
          </div>

          <div className="mt-3 space-y-2">
            {[candidate.earlier, candidate.later].map((side) => (
              <div key={side.id}>
                <button
                  type="button"
                  onClick={() => keep(candidate, side.id)}
                  disabled={pending}
                  className="min-h-11 w-full rounded-xl p-3 text-left disabled:opacity-50"
                  style={{ background: 'var(--plane)' }}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm" style={{ color: 'var(--ink)' }}>
                      {side.label}
                    </span>
                    <span
                      className="shrink-0 text-xs font-semibold"
                      style={{ color: 'var(--accent)' }}
                    >
                      これを残す
                    </span>
                  </div>
                  <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {formatDateJa(side.occurredOn)} / {SOURCE_LABEL[side.source]} /{' '}
                    {side.accountName}
                  </p>
                </button>
                {side.receiptImageUrl ? (
                  // 別タブで開く(このボタンを押すと保存操作が走るため、リンクの
                  // クリックがボタンの onClick を発火しないようにしている)。
                  <a
                    href={side.receiptImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="min-h-11 mt-1 inline-block px-3 text-xs font-medium underline decoration-dotted underline-offset-4"
                    style={{ color: 'var(--accent)' }}
                  >
                    レシートの写真を見る
                  </a>
                ) : null}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              run(() =>
                saveDistinctPairAction(
                  candidate.earlier.id,
                  candidate.later.id,
                  candidate.signature,
                ),
              )
            }
            disabled={pending}
            className="min-h-11 mt-2 text-xs disabled:opacity-50"
            style={{ color: 'var(--ink-muted)' }}
          >
            別の買い物なので、どちらも残す
          </button>
        </div>
      ))}

      {decided.length > 0 ? (
        <details className="rounded-2xl p-4" style={{ background: 'var(--surface)' }}>
          <summary
            className="min-h-11 cursor-pointer text-sm font-medium"
            style={{ color: 'var(--ink)' }}
          >
            確認済み {decided.length}組
          </summary>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            過去90日分。どちらの明細も集計に含めています。
          </p>
          <div className="mt-3 space-y-4">
            {decided.map((candidate) => (
              <div key={candidate.key}>
                <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                  {formatYen(candidate.earlier.amountYen, { sign: 'never' })} の2件
                </p>
                {[candidate.earlier, candidate.later].map((side) => (
                  <div
                    key={side.id}
                    className="mt-1 text-xs"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    <p>
                      {side.label} / {formatDateJa(side.occurredOn)} / {SOURCE_LABEL[side.source]} /{' '}
                      {side.accountName}
                    </p>
                    {side.receiptImageUrl ? (
                      <a
                        href={side.receiptImageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="min-h-11 inline-flex items-center underline decoration-dotted"
                        style={{ color: 'var(--accent)' }}
                      >
                        レシートの写真を見る
                      </a>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    run(() =>
                      undoDistinctPairAction(
                        candidate.earlier.id,
                        candidate.later.id,
                        candidate.signature,
                      ),
                    )
                  }
                  disabled={pending}
                  className="min-h-11 mt-1 text-xs disabled:opacity-50"
                  style={{ color: 'var(--accent)' }}
                >
                  判断を取り消して、もう一度確認する
                </button>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
