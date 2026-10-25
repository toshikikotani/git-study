'use client';

import { useEffect, useRef, useState } from 'react';

import { formatYen } from '@/domain/money';
import {
  deleteBrowserSplitPaymentTracking,
  removeImportedBrowserSplitPayments,
  updateBrowserSplitPaymentReceived,
  useBrowserSplitPaymentTracking,
} from '@/features/split-payments/browser-store';
import {
  MAX_TRACKING_IMPORT,
  type TrackedSplitPayment,
  type TrackingListResult,
  type TrackingStorage,
} from '@/features/split-payments/types';
import {
  deleteSplitPaymentTrackingAction,
  importBrowserSplitPaymentTrackingAction,
  loadSplitPaymentTrackingAction,
  updateSplitPaymentReceivedAction,
} from '../spending/split-payment-tracking-actions';

type Receipt = {
  request: TrackedSplitPayment;
  storage: TrackingStorage;
  conflictingDatabase?: TrackedSplitPayment | undefined;
};
type Retry =
  | { kind: 'update'; receivedCount: number }
  | { kind: 'delete' }
  | { kind: 'reconcile'; useLocal: boolean };
type RowState = {
  draft?: string | undefined;
  confirmingDelete?: boolean | undefined;
  error?: string | undefined;
  retry?: Retry | undefined;
};

const rowKey = ({ request, storage }: Receipt) => `${storage}:${request.id}`;
const names = (request: TrackedSplitPayment) =>
  request.entries.map((entry) => entry.label).join('・');
const connectionError = '保存できませんでした。接続を確認して、もう一度お試しください。';
const safeError = (error: unknown, fallback: string) =>
  error instanceof Error && /[ぁ-んァ-ヶ一-龠]/u.test(error.message) ? error.message : fallback;

/** 成功した受取チェックだけ反映する。ブラウザ保存は本人の記録だけを使う。 */
export function SplitPaymentReceiptList({ initial }: { initial: TrackingListResult }) {
  const userId = initial.userId;
  const browser = useBrowserSplitPaymentTracking(userId);
  const [requests, setRequests] = useState(initial.requests);
  const [storage, setStorage] = useState(initial.storage);
  const [loadError, setLoadError] = useState(initial.error);
  const [serverInitial, setServerInitial] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const busyRef = useRef(new Set<string>());
  const [importing, setImporting] = useState(false);
  const importingRef = useRef(false);
  const attemptedImport = useRef('');
  const importedIds = useRef(new Set<string>());
  const [importError, setImportError] = useState<string | null>(null);
  const [importRetry, setImportRetry] = useState(0);
  const mounted = useRef(false);

  // 同じ利用者のrefreshでは、未解決のブラウザ記録と取り込み履歴を保持する。
  if (serverInitial !== initial) {
    setServerInitial(initial);
    setRequests(initial.requests);
    setStorage(initial.storage);
    setLoadError(initial.error);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // DBが使えるようになったら、保存済みの受取状況を優先して引き継ぐ。
  // 失敗時にはローカルを消さず、同じ内容への自動再試行を繰り返さない。
  useEffect(() => {
    if (storage !== 'database' || !userId || loadError || browser.requests.length === 0) return;
    const originals = browser.requests.filter((request) => !importedIds.current.has(request.id));
    if (originals.length === 0) return;
    const attempt = `${importRetry}:${originals.map((request) => `${request.id}:${request.version}`).join(',')}`;
    if (attemptedImport.current === attempt || importingRef.current) return;
    attemptedImport.current = attempt;
    importingRef.current = true;
    void (async () => {
      try {
        await Promise.resolve();
        if (!mounted.current) return;
        setImporting(true);
        setImportError(null);
        for (let offset = 0; offset < originals.length; offset += MAX_TRACKING_IMPORT) {
          const batch = originals.slice(offset, offset + MAX_TRACKING_IMPORT);
          const result = await importBrowserSplitPaymentTrackingAction(batch);
          if (!mounted.current) return;
          if (result.error || result.storage !== 'database' || result.userId !== userId) {
            throw new Error(result.error ?? 'このブラウザの割り勘を引き継げませんでした。');
          }
          setRequests(result.requests);
          // 引き継ぎ中の別タブ更新を、次の自動取り込みで削除しない。
          const conflicts = new Set(result.conflicts ?? []);
          const imported = batch.filter((request) => !conflicts.has(request.signature));
          if (imported.length > 0) await removeImportedBrowserSplitPayments(userId, imported);
          batch.forEach((request) => importedIds.current.add(request.id));
        }
      } catch (error) {
        if (mounted.current) {
          setImportError(
            error instanceof Error && /[ぁ-んァ-ヶ一-龠]/u.test(error.message)
              ? error.message
              : 'このブラウザの割り勘を引き継げませんでした。もう一度お試しください。',
          );
        }
      } finally {
        importingRef.current = false;
        if (mounted.current) setImporting(false);
      }
    })();
  }, [storage, userId, loadError, browser.requests, importRetry, importing]);

  const databaseBySignature = new Map(requests.map((request) => [request.signature, request]));
  const receipts: Receipt[] = [
    ...(storage === 'database'
      ? requests.map((request) => ({ request, storage: 'database' as const }))
      : []),
    ...(userId
      ? browser.requests.flatMap((request) => {
          const database =
            storage === 'database' ? databaseBySignature.get(request.signature) : undefined;
          if (!database) return [{ request, storage: 'browser' as const }];
          // 人数が異なるブラウザ記録は、再読み込み後もDBの同じ依頼に隠さない。
          const retry = rows[rowKey({ request, storage: 'browser' })]?.retry;
          return database.receivedCount !== request.receivedCount || retry?.kind === 'reconcile'
            ? [{ request, storage: 'browser' as const, conflictingDatabase: database }]
            : [];
        })
      : []),
  ].sort((a, b) => b.request.createdAt.localeCompare(a.request.createdAt));
  const pending = receipts.filter(
    ({ request, conflictingDatabase }) =>
      conflictingDatabase || request.receivedCount < request.participants - 1,
  );
  const completed = receipts.filter(
    ({ request, conflictingDatabase }) =>
      !conflictingDatabase && request.receivedCount === request.participants - 1,
  );

  function changeRow(key: string, patch: RowState) {
    setRows((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  async function update(receipt: Receipt, receivedCount: number) {
    const { request } = receipt;
    const key = rowKey(receipt);
    if (!userId || busyRef.current.has(key) || importingRef.current) return;
    busyRef.current.add(key);
    setBusy(new Set(busyRef.current));
    setRows((current) => ({ ...current, [key]: { draft: current[key]?.draft } }));
    try {
      if (receipt.storage === 'browser') {
        await updateBrowserSplitPaymentReceived(userId, request.id, request.version, receivedCount);
      } else {
        const result = await updateSplitPaymentReceivedAction({
          id: request.id,
          expectedVersion: request.version,
          receivedCount,
        });
        if (
          result.error ||
          !result.request ||
          result.userId !== userId ||
          result.storage !== 'database'
        ) {
          throw new Error(result.error ?? connectionError);
        }
        const updated = result.request;
        setRequests((current) =>
          current.map((value) => (value.id === request.id ? updated : value)),
        );
      }
      setRows((current) => ({ ...current, [key]: {} }));
    } catch (error) {
      changeRow(key, {
        error: safeError(error, connectionError),
        retry: { kind: 'update', receivedCount },
      });
    } finally {
      busyRef.current.delete(key);
      setBusy(new Set(busyRef.current));
    }
  }

  async function remove(receipt: Receipt) {
    const { request } = receipt;
    const key = rowKey(receipt);
    if (!userId || busyRef.current.has(key) || importingRef.current) return;
    busyRef.current.add(key);
    setBusy(new Set(busyRef.current));
    changeRow(key, { error: undefined, retry: undefined });
    try {
      if (receipt.storage === 'browser') {
        await deleteBrowserSplitPaymentTracking(userId, request.id, request.version);
      } else {
        const result = await deleteSplitPaymentTrackingAction({
          id: request.id,
          expectedVersion: request.version,
        });
        if (result.error) throw new Error(result.error);
        setRequests((current) => current.filter((value) => value.id !== request.id));
      }
    } catch (error) {
      changeRow(key, {
        error: safeError(error, connectionError),
        retry: { kind: 'delete' },
      });
    } finally {
      busyRef.current.delete(key);
      setBusy(new Set(busyRef.current));
    }
  }

  async function reconcile(receipt: Receipt, useLocal: boolean) {
    const database = receipt.conflictingDatabase;
    if (!userId || !database || importingRef.current) return;
    const key = rowKey(receipt);
    const databaseKey = rowKey({ request: database, storage: 'database' });
    if (busyRef.current.has(key) || busyRef.current.has(databaseKey)) return;
    busyRef.current.add(key);
    busyRef.current.add(databaseKey);
    setBusy(new Set(busyRef.current));
    changeRow(key, { error: undefined, retry: undefined });
    try {
      if (useLocal && database.receivedCount !== receipt.request.receivedCount) {
        const result = await updateSplitPaymentReceivedAction({
          id: database.id,
          expectedVersion: database.version,
          receivedCount: receipt.request.receivedCount,
        });
        if (
          result.error ||
          !result.request ||
          result.userId !== userId ||
          result.storage !== 'database'
        ) {
          throw new Error(result.error ?? connectionError);
        }
        const updated = result.request;
        setRequests((current) =>
          current.map((request) => (request.id === database.id ? updated : request)),
        );
      }
      // 別タブでさらに変わっていたら削除しない。確認し直してもらう。
      await deleteBrowserSplitPaymentTracking(userId, receipt.request.id, receipt.request.version);
    } catch (error) {
      changeRow(key, {
        error: safeError(error, connectionError),
        retry: { kind: 'reconcile', useLocal },
      });
    } finally {
      busyRef.current.delete(key);
      busyRef.current.delete(databaseKey);
      setBusy(new Set(busyRef.current));
    }
  }

  async function reload() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const result = await loadSplitPaymentTrackingAction();
      if (result.error) throw new Error(result.error);
      if (result.userId !== userId)
        throw new Error('ログイン状態が変わりました。今日の画面を開き直してください。');
      setRequests(result.requests);
      setStorage(result.storage);
      setLoadError(null);
      setRows({});
    } catch (error) {
      setLoadError(safeError(error, '受取状況を取得できませんでした。'));
    } finally {
      setRefreshing(false);
    }
  }

  function receiptRow(receipt: Receipt) {
    const { request } = receipt;
    const key = rowKey(receipt);
    const row = rows[key] ?? {};
    const others = request.participants - 1;
    const isComplete = request.receivedCount === others;
    const disabled = busy.has(key) || importing;
    const draft = row.draft ?? String(request.receivedCount);
    const validCount =
      /^\d+$/.test(draft) && Number.isSafeInteger(Number(draft)) && Number(draft) <= others;
    const checkboxLabel = others === 1 ? '受け取った' : '全員から受け取った';
    return (
      <li key={key} className="rounded-2xl p-4" style={{ background: 'var(--surface)' }}>
        <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          {[...new Set(request.entries.map((entry) => entry.occurredOn.replaceAll('-', '/')))].join(
            '・',
          )}
        </p>
        <p className="mt-1 break-words text-[16px] font-semibold">{names(request)}</p>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
            相手{others.toLocaleString('ja-JP')}人 × {formatYen(request.amountPerPersonYen)}
          </p>
          <p className="tabular text-[15px] font-semibold">
            {isComplete
              ? '受取済み'
              : `未受取 ${formatYen(request.amountPerPersonYen * (others - request.receivedCount))}`}
          </p>
        </div>
        {receipt.storage === 'browser' ? (
          <p className="mt-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            このブラウザに保存
          </p>
        ) : null}
        {receipt.conflictingDatabase ? (
          <div className="mt-3 text-[13px]">
            <p role="status" className="font-semibold">
              {receipt.conflictingDatabase.receivedCount !== request.receivedCount
                ? 'このブラウザに未反映の受取状況があります'
                : 'このブラウザの受取記録を整理してください'}
            </p>
            <p className="mt-1" style={{ color: 'var(--ink-secondary)' }}>
              このブラウザは{request.receivedCount.toLocaleString('ja-JP')}人、アカウントは
              {receipt.conflictingDatabase.receivedCount.toLocaleString('ja-JP')}
              人から受取済みです。
            </p>
            <div className="mt-1 flex flex-col items-start">
              <button
                type="button"
                disabled={disabled}
                onClick={() => void reconcile(receipt, true)}
                className="min-h-11 text-left font-semibold disabled:opacity-40"
                style={{ color: 'var(--accent)' }}
              >
                このブラウザの受取人数を反映
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void reconcile(receipt, false)}
                className="min-h-11 text-left font-semibold disabled:opacity-40"
                style={{ color: 'var(--ink-secondary)' }}
              >
                アカウントの受取状況を使う
              </button>
            </div>
          </div>
        ) : (
          <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-[15px] font-semibold">
            <input
              type="checkbox"
              checked={isComplete}
              disabled={disabled}
              aria-label={`${checkboxLabel}: ${names(request)}`}
              onChange={(event) => void update(receipt, event.target.checked ? others : 0)}
              className="size-5 shrink-0 accent-[var(--accent)]"
            />
            {checkboxLabel}
            {busy.has(key) ? <span className="text-[12px]">保存中…</span> : null}
          </label>
        )}
        {request.receivedCount > 0 && !isComplete ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
            {request.receivedCount.toLocaleString('ja-JP')} / {others.toLocaleString('ja-JP')}
            人から受取済み
          </p>
        ) : null}
        {row.error ? (
          <div role="alert" className="mt-2 text-[13px]" style={{ color: 'var(--over)' }}>
            <p>{row.error}</p>
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                row.retry?.kind === 'update'
                  ? void update(receipt, row.retry.receivedCount)
                  : row.retry?.kind === 'reconcile'
                    ? void reconcile(receipt, row.retry.useLocal)
                    : void remove(receipt)
              }
              className="min-h-11 font-semibold underline disabled:opacity-40"
            >
              再試行
            </button>
            <button
              type="button"
              disabled={disabled || refreshing}
              onClick={() => void reload()}
              className="ml-4 min-h-11 font-semibold underline disabled:opacity-40"
            >
              最新の状況を読み込む
            </button>
          </div>
        ) : null}
        <details className="mt-1 text-[13px]">
          <summary
            className="min-h-11 cursor-pointer content-center"
            style={{ color: 'var(--accent)' }}
          >
            {receipt.conflictingDatabase ? '依頼の内容' : '一部だけ受け取った・内容'}
          </summary>
          {!receipt.conflictingDatabase ? (
            <>
              <div className="mt-1 flex flex-wrap items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-[13px]">
                  受け取った人数（相手{others.toLocaleString('ja-JP')}人中）
                  <input
                    type="text"
                    inputMode="numeric"
                    value={draft}
                    disabled={disabled}
                    aria-label={`受け取った人数: ${names(request)}`}
                    aria-invalid={!validCount}
                    onChange={(event) => changeRow(key, { draft: event.target.value })}
                    className="min-h-11 w-full rounded-xl border px-3 text-[16px]"
                    style={{ background: 'var(--plane)', borderColor: 'var(--hairline)' }}
                  />
                </label>
                <button
                  type="button"
                  disabled={disabled || !validCount || Number(draft) === request.receivedCount}
                  onClick={() => (validCount ? void update(receipt, Number(draft)) : undefined)}
                  className="btn-primary min-h-11 rounded-xl px-4 font-semibold"
                >
                  反映
                </button>
              </div>
              {!validCount ? (
                <p className="mt-1 text-[13px]" style={{ color: 'var(--over)' }}>
                  0〜{others.toLocaleString('ja-JP')}人の整数を入力してください。
                </p>
              ) : null}
            </>
          ) : null}
          <ul className="mt-4 space-y-2 text-[13px]" aria-label="依頼した明細">
            {request.entries.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-3">
                <span className="min-w-0 break-words">
                  {entry.occurredOn.replaceAll('-', '/')} {entry.label}
                  {entry.branchName ? ` ${entry.branchName}` : ''}
                </span>
                <span className="tabular shrink-0">{formatYen(-entry.amountYen)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            合計{formatYen(request.totalYen)} · 自分を含め
            {request.participants.toLocaleString('ja-JP')}人
          </p>
          {receipt.conflictingDatabase ? null : row.confirmingDelete ? (
            <div className="mt-4 text-[13px]">
              <p>この請求の受取チェックを削除します。明細は残ります。</p>
              <div className="flex flex-wrap gap-4">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => changeRow(key, { confirmingDelete: false })}
                  className="min-h-11 font-semibold"
                  style={{ color: 'var(--accent)' }}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void remove(receipt)}
                  className="min-h-11 font-semibold disabled:opacity-40"
                  style={{ color: 'var(--over)' }}
                >
                  削除する
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => changeRow(key, { confirmingDelete: true })}
              className="mt-2 min-h-11 text-[13px] font-semibold disabled:opacity-40"
              style={{ color: 'var(--ink-muted)' }}
            >
              受取チェックを削除
            </button>
          )}
        </details>
      </li>
    );
  }

  const error = loadError ?? browser.error;
  if (receipts.length === 0 && !error && !importError) return null;
  return (
    <section
      aria-labelledby="home-split-receipts"
      className="hm-section"
      style={{ color: 'var(--ink)' }}
    >
      <h2 id="home-split-receipts" className="hm-section__header text-[20px] font-semibold">
        割り勘の受取待ち
      </h2>
      {error ? (
        <div
          role="alert"
          className="hm-panel text-[13px]"
          style={{ background: 'var(--surface)', color: 'var(--over)' }}
        >
          <p>{error}</p>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void reload()}
            className="min-h-11 font-semibold underline disabled:opacity-40"
          >
            {refreshing ? '読み込み中…' : '再読み込み'}
          </button>
        </div>
      ) : null}
      {importing ? (
        <p role="status" className="px-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          このブラウザの割り勘を引き継いでいます…
        </p>
      ) : null}
      {importError ? (
        <div role="alert" className="px-1 text-[13px]" style={{ color: 'var(--over)' }}>
          <p>{importError}このブラウザの記録は残っています。</p>
          <button
            type="button"
            disabled={importing}
            onClick={() => setImportRetry((value) => value + 1)}
            className="min-h-11 font-semibold underline disabled:opacity-40"
          >
            引き継ぎを再試行
          </button>
        </div>
      ) : null}
      {pending.length > 0 ? <ul className="space-y-4">{pending.map(receiptRow)}</ul> : null}
      {completed.length > 0 ? (
        <details className="border-t" style={{ borderColor: 'var(--hairline)' }}>
          <summary
            className="min-h-12 cursor-pointer content-center px-4 text-[15px] font-semibold"
            style={{ color: 'var(--ink-secondary)' }}
          >
            受取済み（{completed.length}件）
          </summary>
          <ul className="space-y-2">{completed.map(receiptRow)}</ul>
        </details>
      ) : null}
    </section>
  );
}
