'use client';

/** 「スクショから記録」(N3)。 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { fingerprintOf, type StoredTransaction } from '@/features/transactions/types';
import { fetchAccounts, type AccountOption } from '@/features/transactions/accounts-client';
import { resizeToJpegBase64 } from '@/features/import/resize-image';
import { hapticFor } from '@/lib/haptics';
import { pushUndo } from '@/lib/undo';
import { resolveGenreHint } from '@/domain/genre-hint';
import { saveImportBatchAction, undoReceiptSaveAction } from '../actions';
import {
  extractFromScreenshotAction,
  fetchGenreNameOptionsAction,
  type GenreNameOption,
  type ScreenshotCandidateWithDuplicate,
} from '../capture-actions';
import { CaptureCandidateCard, type EditableCandidate } from '../capture-candidate-card';

type Row = EditableCandidate & {
  key: string;
  status: 'idle' | 'saving' | 'saved' | 'error' | 'linked';
  duplicateOf: ScreenshotCandidateWithDuplicate['possibleDuplicate'];
};

export function CaptureScreenshotForm() {
  const [genres, setGenres] = useState<GenreNameOption[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    void fetchGenreNameOptionsAction().then(setGenres);
    void fetchAccounts().then(setAccounts);
  }, []);

  async function analyze(files: FileList | null): Promise<void> {
    if (files === null || files.length === 0) return;
    setAnalyzing(true);
    setError(null);
    setWarnings([]);
    const nextRows: Row[] = [];
    for (const file of Array.from(files)) {
      const base64 = await resizeToJpegBase64(file);
      const result = await extractFromScreenshotAction(base64, 'image/jpeg');
      setWarnings((prev) => [...prev, ...result.warnings]);
      if (result.error) {
        setError(result.error);
        continue;
      }
      for (const c of result.candidates) {
        nextRows.push({
          key: `${Date.now()}-${nextRows.length}`,
          occurredOn: c.occurredOn,
          amountYen: c.amountYen,
          storeName: c.storeName,
          genreId: resolveGenreHint(c.genreHint, genres),
          confidence: c.confidence,
          status: 'idle',
          duplicateOf: c.possibleDuplicate,
        });
      }
    }
    setAnalyzing(false);
    setRows((prev) => [...prev, ...nextRows]);
  }

  async function save(row: Row): Promise<void> {
    const account = accounts[0];
    if (!account) return;
    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, status: 'saving' } : r)));
    const genre = genres.find((g) => g.id === row.genreId);
    const store = row.storeName.trim() === '' ? 'スクショから記録' : row.storeName.trim();
    const amountYen = -Math.abs(row.amountYen);
    const preview: StoredTransaction = {
      id: 'capture-0',
      accountId: account.id,
      occurredOn: row.occurredOn,
      description: store,
      merchantName: store,
      amountYen,
      paymentMethod: 'one_time',
      genreId: row.genreId,
      genreName: genre?.name ?? null,
      classifiedBy: row.genreId ? 'manual' : 'unclassified',
      confidence: null,
      reviewStatus: 'auto_ok',
      mustPay: false,
      kind: 'normal',
      source: 'manual',
      fingerprint: fingerprintOf({ occurredOn: row.occurredOn, amountYen, description: store }),
      batchId: null,
      sourceRef: null,
      memo: null,
    };
    const outcome = await saveImportBatchAction([preview], {
      fileName: 'スクショから記録',
      source: 'manual',
      accountId: account.id,
      failedCount: 0,
    });
    if (outcome.error) {
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, status: 'error' } : r)));
      return;
    }
    hapticFor('save');
    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, status: 'saved' } : r)));
    if (outcome.insertedIds.length > 0) {
      const ids = outcome.insertedIds;
      pushUndo(`${store} を登録しました`, async () => {
        const r = await undoReceiptSaveAction(ids);
        if (r.error === null) {
          setRows((prev) =>
            prev.map((row2) => (row2.key === row.key ? { ...row2, status: 'idle' } : row2)),
          );
        }
        return r.error;
      });
    }
  }

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          スクショから記録
        </h1>
        <Link
          href="/transactions"
          className="min-h-11 flex items-center text-xs"
          style={{ color: 'var(--ink-muted)' }}
        >
          やめる
        </Link>
      </header>

      <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        決済アプリの支払い完了画面、ネット通販の注文完了画面、カードの利用通知のスクリーンショットを選ぶと、取引の候補を作ります。
      </p>

      <label
        className="glass flex min-h-11 cursor-pointer items-center justify-center rounded-2xl py-6 text-sm font-semibold"
        style={{
          background: 'var(--surface)',
          color: 'var(--accent)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        {analyzing ? '解析しています…' : 'スクリーンショットを選ぶ'}
        <input
          type="file"
          accept="image/*"
          multiple
          hidden
          disabled={analyzing}
          onChange={(e) => {
            void analyze(e.target.files);
            e.target.value = '';
          }}
        />
      </label>

      {error ? (
        <p className="text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
      {warnings.length > 0 ? (
        <ul className="space-y-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-3">
        {rows.map((row) =>
          row.status === 'linked' ? (
            <div
              key={row.key}
              className="rounded-2xl p-3 text-sm"
              style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
            >
              既存の取引に紐付けました(新規登録はしていません)
            </div>
          ) : (
            <CaptureCandidateCard
              key={row.key}
              candidate={row}
              onChange={(next) =>
                setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, ...next } : r)))
              }
              genres={genres}
              accountName={accounts[0]?.name ?? '(口座未登録)'}
              status={row.status}
              onSave={() => void save(row)}
              onDiscard={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
              duplicateOf={row.duplicateOf}
              onLinkExisting={() =>
                setRows((prev) =>
                  prev.map((r) => (r.key === row.key ? { ...r, status: 'linked' } : r)),
                )
              }
            />
          ),
        )}
      </div>
    </div>
  );
}
