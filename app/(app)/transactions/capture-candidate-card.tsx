'use client';

/**
 * AI入力(N3)の確認カード。「話して記録」「文字で記録」「スクショから記録」で
 * 共通。信頼度の低い項目は黄色でハイライトする(本人要件)。
 */

import { formatYen } from '@/domain/money';
import { addDays, type DateOnly } from '@/lib/date';

export const LOW_CONFIDENCE_THRESHOLD = 0.6;

export type EditableCandidate = {
  occurredOn: DateOnly;
  amountYen: number;
  storeName: string;
  genreId: string | null;
  confidence: number;
};

export function CaptureCandidateCard({
  candidate,
  onChange,
  genres,
  accountName,
  status,
  onSave,
  onDiscard,
  duplicateOf,
  onLinkExisting,
}: {
  candidate: EditableCandidate;
  onChange: (next: EditableCandidate) => void;
  genres: readonly { id: string; name: string }[];
  accountName: string;
  status: 'idle' | 'saving' | 'saved' | 'error';
  onSave: () => void;
  onDiscard: () => void;
  /** 重複の疑いがある既存の明細(スクショから記録のときだけ)。 */
  duplicateOf?: { id: string; description: string; occurredOn: DateOnly; amountYen: number } | null;
  onLinkExisting?: () => void;
}) {
  const lowConfidence = candidate.confidence < LOW_CONFIDENCE_THRESHOLD;

  if (status === 'saved') {
    return (
      <div
        className="rounded-2xl p-3 text-sm"
        style={{ background: 'var(--accent-track)', color: 'var(--ink)' }}
      >
        {candidate.storeName || '(店名なし)'} {formatYen(candidate.amountYen, { sign: 'never' })}{' '}
        を登録しました
      </div>
    );
  }

  return (
    <div
      className="glass space-y-2 rounded-2xl p-3"
      style={{
        background: 'var(--surface)',
        boxShadow: 'var(--card-shadow)',
        border: lowConfidence ? '1px solid var(--state-caution)' : '1px solid transparent',
      }}
    >
      {lowConfidence ? (
        <p className="text-xs font-semibold" style={{ color: 'var(--state-caution)' }}>
          <span aria-hidden>▲ </span>読み取りの確信が低めです。内容を確認してください
        </p>
      ) : null}

      {duplicateOf ? (
        <div
          className="space-y-2 rounded-xl p-2 text-xs"
          style={{ background: 'var(--state-caution-track)', color: 'var(--ink)' }}
        >
          <p>
            <span aria-hidden>▲ </span>
            似た明細が既にあります:{duplicateOf.description}{' '}
            {formatYen(duplicateOf.amountYen, { sign: 'never' })}({duplicateOf.occurredOn})
          </p>
          <button
            type="button"
            onClick={onLinkExisting}
            className="min-h-11 rounded-full px-3 text-xs font-semibold"
            style={{ background: 'var(--surface)', color: 'var(--ink)' }}
          >
            既存の取引に紐付ける(新規登録しない)
          </button>
        </div>
      ) : null}

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="前の日"
          onClick={() => onChange({ ...candidate, occurredOn: addDays(candidate.occurredOn, -1) })}
          className="min-h-11 min-w-11 text-base"
          style={{ color: 'var(--ink-secondary)' }}
        >
          ‹
        </button>
        <input
          type="date"
          value={candidate.occurredOn}
          onChange={(e) => onChange({ ...candidate, occurredOn: e.target.value })}
          className="min-h-11 flex-1 bg-transparent text-center text-sm outline-none"
          style={{ color: 'var(--ink)' }}
        />
        <button
          type="button"
          aria-label="次の日"
          onClick={() => onChange({ ...candidate, occurredOn: addDays(candidate.occurredOn, 1) })}
          className="min-h-11 min-w-11 text-base"
          style={{ color: 'var(--ink-secondary)' }}
        >
          ›
        </button>
      </div>

      <input
        aria-label="店名"
        value={candidate.storeName}
        onChange={(e) => onChange({ ...candidate, storeName: e.target.value })}
        placeholder="店名"
        className="min-h-11 w-full rounded-xl px-3 text-sm outline-none"
        style={{ background: 'var(--plane)', color: 'var(--ink)' }}
      />

      <div className="flex items-center gap-2">
        <input
          aria-label="金額"
          inputMode="numeric"
          value={candidate.amountYen.toLocaleString('ja-JP')}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, '');
            onChange({ ...candidate, amountYen: digits === '' ? 0 : Number(digits.slice(0, 9)) });
          }}
          className="tabular min-h-11 flex-1 rounded-xl px-3 text-right text-sm outline-none"
          style={{ background: 'var(--plane)', color: 'var(--ink)' }}
        />
        <span className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
          円
        </span>
      </div>

      <select
        aria-label="ジャンル"
        value={candidate.genreId ?? ''}
        onChange={(e) =>
          onChange({ ...candidate, genreId: e.target.value === '' ? null : e.target.value })
        }
        className="min-h-11 w-full rounded-xl px-3 text-sm outline-none"
        style={{ background: 'var(--plane)', color: 'var(--ink)' }}
      >
        <option value="">ジャンルを選ぶ</option>
        {genres.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>

      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        口座: {accountName}
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={status === 'saving' || candidate.amountYen === 0}
          className="min-h-11 flex-1 rounded-xl text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--action)', color: 'var(--on-action)' }}
        >
          {status === 'saving' ? '登録中…' : '登録する'}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={status === 'saving'}
          className="min-h-11 rounded-xl px-4 text-sm disabled:opacity-40"
          style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
        >
          取り消す
        </button>
      </div>

      {status === 'error' ? (
        <p className="text-xs" style={{ color: 'var(--over)' }}>
          登録に失敗しました。もう一度お試しください。
        </p>
      ) : null}
    </div>
  );
}
