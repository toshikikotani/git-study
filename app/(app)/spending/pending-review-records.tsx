'use client';

import { useState } from 'react';

import type { LedgerTransaction } from '@/features/spending/ledger-types';
import { formatDateJa } from '@/lib/date';
import { CategoryMark } from '../category-sheet';
import { DirectRecordEditor } from '../transactions/direct-record-editor';

/**
 * 自動分類の確認待ちだけ。開くのは押したときだけ(勝手に開くと、LINE から来た答え合わせのシートと
 * 重なる、ADR-131)。保存したら次へ進む。
 */
export function PendingReviewRecords({ records }: { records: readonly LedgerTransaction[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [handled, setHandled] = useState<ReadonlySet<string>>(new Set());
  const remaining = records.filter((r) => !handled.has(r.id));
  if (remaining.length === 0)
    return (
      <p role="status" className="px-4 py-6 text-sm" style={{ color: 'var(--ink-muted)' }}>
        カテゴリの確認待ちはありません。
      </p>
    );
  return (
    <ul className="overflow-hidden rounded-2xl" style={{ background: 'var(--surface)' }}>
      {remaining.map((t, index) => (
        <li
          key={t.id}
          className="flex items-center gap-2 px-3 py-2"
          style={index > 0 ? { borderTop: '1px solid var(--hairline)' } : undefined}
        >
          <CategoryMark genreId={t.genreId} name={t.genreName} />
          <DirectRecordEditor
            key={`${t.id}:${openId === t.id}`}
            transaction={t}
            initialOpen={openId === t.id}
            confirmReview
            onSaved={() => {
              setHandled((value) => new Set(value).add(t.id));
              setOpenId(remaining.find((r) => r.id !== t.id)?.id ?? null);
            }}
            onRestored={() =>
              setHandled((value) => {
                const next = new Set(value);
                next.delete(t.id);
                return next;
              })
            }
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>
                {t.label}
              </span>
              <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                {formatDateJa(t.occurredOn)} · {t.genreName ?? '未分類'} · カテゴリ確認
              </span>
            </span>
            <span
              className="tabular shrink-0 text-[15px] font-semibold"
              style={{ color: 'var(--ink)' }}
            >
              {Math.abs(t.amountYen).toLocaleString('ja-JP')}円
            </span>
          </DirectRecordEditor>
        </li>
      ))}
    </ul>
  );
}
