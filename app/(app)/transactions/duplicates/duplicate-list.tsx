'use client';

import { useState } from 'react';

import { formatYen } from '@/domain/money';
import type {
  DuplicateCandidateView,
  DuplicateSideView,
} from '@/features/transactions/duplicates-store';
import { formatDateJa } from '@/lib/date';
import { ignoreTransactionAction } from './actions';

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
 * 「別の買い物」で候補から消すだけ(どちらも残る)。
 */
export function DuplicateList({ initial }: { initial: readonly DuplicateCandidateView[] }) {
  const [candidates, setCandidates] = useState<DuplicateCandidateView[]>([...initial]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keep = async (candidate: DuplicateCandidateView, keepId: string) => {
    const ignoreId = candidate.earlier.id === keepId ? candidate.later.id : candidate.earlier.id;

    setSavingId(keepId);
    setError(null);

    const result = await ignoreTransactionAction(ignoreId);
    if (result.error) {
      setError(result.error);
      setSavingId(null);
      return;
    }

    setCandidates((current) => current.filter((c) => c.earlier.id !== candidate.earlier.id));
    setSavingId(null);
  };

  const dismiss = (candidate: DuplicateCandidateView) => {
    setCandidates((current) => current.filter((c) => c.earlier.id !== candidate.earlier.id));
  };

  if (candidates.length === 0) {
    return (
      <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        同じ買い物が二重に入っていそうな明細は見つかりませんでした。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {candidates.map((candidate) => (
        <div
          key={candidate.earlier.id}
          className="rounded-2xl p-4"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              {formatYen(candidate.earlier.amountYen, { sign: 'never' })} が2件
            </p>
            <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {candidate.dayGap === 0 ? '同じ日' : `${candidate.dayGap}日違い`}
            </p>
          </div>

          <div className="mt-3 space-y-2">
            {[candidate.earlier, candidate.later].map((side) => (
              <div key={side.id}>
                <button
                  type="button"
                  onClick={() => keep(candidate, side.id)}
                  disabled={savingId !== null}
                  className="w-full rounded-xl p-3 text-left disabled:opacity-50"
                  style={{ background: 'var(--plane)' }}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm" style={{ color: 'var(--ink)' }}>
                      {side.label}
                    </span>
                    <span
                      className="shrink-0 text-[11px] font-semibold"
                      style={{ color: 'var(--accent)' }}
                    >
                      これを残す
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
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
                    className="mt-1 inline-block px-3 text-[11px] font-medium underline decoration-dotted underline-offset-4"
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
            onClick={() => dismiss(candidate)}
            disabled={savingId !== null}
            className="mt-2 text-[11px] disabled:opacity-50"
            style={{ color: 'var(--ink-muted)' }}
          >
            別の買い物なので、どちらも残す
          </button>
        </div>
      ))}

      {error !== null ? (
        <p className="text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
