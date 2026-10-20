'use client';

import { markJustSaved } from '@/lib/just-saved';
import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ReceiptConfirm, type ReceiptConfirmSave } from './receipt-confirm';
import {
  recordGenreCorrectionAction,
  saveImportBatchAction,
  undoReceiptSaveAction,
} from '../actions';
import { loadGoalSnapshotAction } from '../../plan/actions';
import type { GoalSnapshot } from '@/domain/goal-impact';
import { formatYen } from '@/domain/money';
import {
  removeReceiptJob,
  retryWaitingJobs,
  useReceiptJobs,
  type ReceiptJob,
} from '@/features/import/receipt-queue';
import { InputAccountSelector, useInputAccount } from '../input-account';
import { fetchGenreOptions, type GenreOption } from '@/features/transactions/genres-client';

/**
 * 読み取ったレシートの確認(撮影 → 読み取り → 確認 → 保存)。明細の「確認が必要」の画面の中に出す
 * (もとは「レシートを確認」の画面、ADR-127 で「確認が必要」1画面にまとめた)。
 *
 * 撮影は読み取りを待たない(features/import/receipt-queue.ts)。撮ったレシートは
 * 裏で読み取られ、ここには「読み取り中」の仮の行(スケルトン)→ 確認カードの順で
 * 出る。確認カード(receipt-confirm.tsx)は、上半分に画像(ズーム可)、下半分に
 * 読み取り結果、下部に固定した照合バーを持つ。保存後は「元に戻す」つきのトースト。
 *
 * ── 経緯 ──────────────────────────────────────────────────
 * 現金・電子マネーなど通知メールもカード明細も無い支払いの主経路(ADR-021)。
 * 銀行アプリの振込完了画面のスクリーンショットも読める(ADR-038)。
 * 口座が1件しか無いときは選ばせず、無ければ「現金」を自動で作る。
 */

type Toast = {
  key: string;
  message: string;
  ids: string[];
  undoing: boolean;
  error: string | null;
};

export function ReceiptResults() {
  const jobs = useReceiptJobs();
  const [genres, setGenres] = useState<GenreOption[]>([]);
  const inputAccount = useInputAccount('', { autoCreateDefault: true });
  const accountId = inputAccount.selectedAccount?.id ?? '';
  const [savingKeys, setSavingKeys] = useState<ReadonlySet<string>>(new Set());
  const savingRef = useRef(new Set<string>());
  const savedRef = useRef(new Map<string, string>());
  const [saved, setSaved] = useState<ReadonlyMap<string, string>>(new Map());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  // 目標があるとき、保存前の影響と保存後のひと言に使う。
  const [goal, setGoal] = useState<{ snapshot: GoalSnapshot; today: string } | null>(null);
  const [goalLoaded, setGoalLoaded] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);

  const loadGoal = useCallback(async () => {
    try {
      const result = await loadGoalSnapshotAction();
      if (result.error) {
        setGoalError(result.error);
        setGoalLoaded(false);
        return;
      }
      setGoalError(null);
      setGoal(result.snapshot ? { snapshot: result.snapshot, today: result.today } : null);
      setGoalLoaded(true);
    } catch {
      setGoalLoaded(false);
      setGoalError('目標への影響を確認できませんでした。読み取り結果はそのまま残っています。');
    }
  }, []);

  useEffect(() => {
    void fetchGenreOptions().then(setGenres);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部の目標データを読み込み、結果を非同期で反映する。
    void loadGoal();
  }, [loadGoal]);

  const save = async (job: ReceiptJob, index: number, input: ReceiptConfirmSave) => {
    const key = `${job.id}:${index}`;
    if (savingRef.current.has(key) || savedRef.current.has(key)) return;
    savingRef.current.add(key);
    setSavingKeys(new Set(savingRef.current));
    setSaveError(null);
    try {
      let receiptImagePath: string | null = null;
      const warnings: string[] = [];
      if (input.imageBase64) {
        try {
          const res = await fetch('/api/import/receipt/upload', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ image: input.imageBase64, mediaType: 'image/jpeg' }),
          });
          const uploaded = (await res.json()) as { path: string | null; error: string | null };
          receiptImagePath = uploaded.path;
          if (uploaded.error) warnings.push(uploaded.error);
        } catch {
          warnings.push('レシート画像を保存できませんでした。');
        }
      }

      const { plan } = input;
      const sourceRef = plan.transaction.sourceRef!;
      const outcome = await saveImportBatchAction(
        [plan.transaction],
        {
          fileName: 'レシート撮影',
          source: 'manual',
          accountId,
          failedCount: 0,
          receiptImagePath,
        },
        plan.splits ? [{ sourceRef, splits: plan.splits }] : [],
        plan.items.length > 0 ? [{ sourceRef, items: plan.items }] : [],
        plan.expenseSubtype ? [{ sourceRef, subtype: plan.expenseSubtype }] : [],
      );
      if (outcome.error) {
        setSaveError(outcome.error);
        return;
      }

      // 直したジャンルは、履歴へ即座に反映する(次のレシートから効く)。
      void Promise.allSettled(
        input.corrections.map((c) =>
          recordGenreCorrectionAction({
            storeName: input.storeName,
            itemName: c.itemName,
            genreId: c.genreId,
          }),
        ),
      );

      markJustSaved(outcome.insertedIds);
      const label = `${input.storeName} ${formatYen(-plan.transaction.amountYen)}`;
      savedRef.current.set(key, label);
      setSaved(new Map(savedRef.current));
      setToast({
        key,
        message:
          outcome.imported === 0
            ? `${label} は既に登録済みのため追加しませんでした`
            : (input.goalMessage ??
              `${label} を保存しました${warnings.length > 0 ? `(${warnings[0]})` : ''}`),
        ids: outcome.insertedIds,
        undoing: false,
        error: null,
      });

      // このジャンルのレシートを全部保存したら、キューから片付ける。
      const allSaved = job.parsed.every((_, i) => savedRef.current.has(`${job.id}:${i}`));
      if (allSaved)
        window.setTimeout(() => {
          if (job.parsed.every((_, i) => savedRef.current.has(`${job.id}:${i}`)))
            removeReceiptJob(job.id);
        }, 800);
    } catch {
      setSaveError(
        '保存できませんでした。読み取り結果は残っています。もう一度「保存する」を押してください。',
      );
    } finally {
      savingRef.current.delete(key);
      setSavingKeys(new Set(savingRef.current));
    }
  };

  const undo = async () => {
    if (!toast) return;
    setToast({ ...toast, undoing: true });
    let result;
    try {
      result = await undoReceiptSaveAction(toast.ids);
    } catch {
      setToast({
        ...toast,
        undoing: false,
        error: '元に戻せませんでした。もう一度お試しください。',
      });
      return;
    }
    if (result.error) {
      setToast({ ...toast, undoing: false, error: result.error });
      return;
    }
    savedRef.current.delete(toast.key);
    setSaved(new Map(savedRef.current));
    setToast(null);
  };

  const reading = jobs.filter((j) => j.status === 'reading');
  const pending = useMemo(
    () => jobs.filter((j) => j.status === 'ready' || j.status === 'error'),
    [jobs],
  );
  const parked = useMemo(
    () => jobs.filter((j) => j.status === 'waiting' || j.status === 'needs_input'),
    [jobs],
  );

  // 読み取ったレシートが無ければ何も出さない(「確認が必要」のほかの項目だけを見せる)。
  if (jobs.length === 0 && toast === null) return null;

  return (
    <section aria-label="読み取ったレシート" className="space-y-4">
      <h2 className="px-1 text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
        読み取ったレシート
      </h2>
      <InputAccountSelector inputAccount={inputAccount} />
      {goalError ? (
        <div role="alert" className="space-y-2 text-xs" style={{ color: 'var(--over)' }}>
          <p>{goalError}</p>
          <button
            type="button"
            onClick={() => void loadGoal()}
            className="min-h-11 font-semibold underline"
          >
            目標への影響を再確認する
          </button>
        </div>
      ) : null}

      {saveError ? (
        <p role="alert" className="text-xs" style={{ color: 'var(--over)' }}>
          {saveError}
        </p>
      ) : null}

      {/* 読み取り中:スケルトン(撮影をブロックしない) */}
      {reading.map((job) => (
        <div
          key={job.id}
          role="status"
          aria-label="読み取り中"
          className="glass flex items-center gap-3 rounded-2xl p-3"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={job.previewUrl} alt="" className="size-14 rounded-lg object-cover" />
          <div className="min-w-0 flex-1 space-y-2">
            <div
              className="h-3 w-2/3 animate-pulse rounded-lg"
              style={{ background: 'var(--hairline)' }}
            />
            <div
              className="h-3 w-1/3 animate-pulse rounded-lg"
              style={{ background: 'var(--hairline)' }}
            />
          </div>
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            読み取り中…
          </span>
        </div>
      ))}

      {parked.map((job) => (
        <ParkedJobCard key={job.id} job={job} />
      ))}

      {pending.map((job) =>
        job.status === 'error' ? (
          <div
            key={job.id}
            role="alert"
            className="glass flex items-center gap-3 rounded-2xl p-3"
            style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={job.previewUrl} alt="" className="size-14 rounded-lg object-cover" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                読み取れませんでした
              </p>
              <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                {job.error ?? '撮り直してください。'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => removeReceiptJob(job.id)}
              className="min-h-11 text-xs font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              閉じる
            </button>
          </div>
        ) : (
          <div key={job.id} className="space-y-3">
            {job.warnings.length > 0 ? (
              <ul className="space-y-1 px-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                {job.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : null}
            {job.parsed.map((_, index) => (
              <ReceiptConfirm
                key={`${job.id}:${index}`}
                job={job}
                index={index}
                genres={genres}
                accountId={accountId}
                saving={savingKeys.has(`${job.id}:${index}`)}
                savedLabel={saved.get(`${job.id}:${index}`) ?? null}
                goal={goal}
                autoSaveReady={goalLoaded}
                onSave={(input) => void save(job, index, input)}
                onDiscard={() => removeReceiptJob(job.id)}
              />
            ))}
          </div>
        ),
      )}

      {toast ? (
        <div
          role="status"
          className="fixed inset-x-4 bottom-28 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm"
          style={{
            background: 'var(--ink)',
            color: 'var(--surface)',
            boxShadow: 'var(--glass-shadow-float)',
          }}
        >
          <span className="min-w-0">{toast.error ?? toast.message}</span>
          <span className="flex shrink-0 gap-3">
            {toast.ids.length > 0 ? (
              <button
                type="button"
                onClick={() => void undo()}
                disabled={toast.undoing}
                className="min-h-11 font-semibold underline disabled:opacity-50"
              >
                元に戻す
              </button>
            ) : null}
            <button
              className="min-h-11"
              type="button"
              aria-label="閉じる"
              onClick={() => setToast(null)}
            >
              ×
            </button>
          </span>
        </div>
      ) : null}
    </section>
  );
}

/**
 * 読み取り待ち(圏外)と入力待ち(読み取れなかった)のカード。どちらも画像は残してあり、
 * 「失敗」とは呼ばない。入力待ちは手入力の画面へ、読み取り待ちは戻れば自動で読み取る。
 */
function ParkedJobCard({ job }: { job: ReceiptJob }) {
  return (
    <div
      className="glass flex items-center gap-3 rounded-2xl p-3"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={job.previewUrl} alt="" className="size-14 rounded-lg object-cover" />
      <div className="min-w-0 flex-1">
        {job.status === 'waiting' ? (
          <>
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              読み取り待ち
            </p>
            <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
              オンラインに戻ると自動で読み取ります。画像は端末に残してあります。
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              入力待ち
            </p>
            <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
              {job.receiptStatus === 'partial'
                ? '一部だけ読み取れました。残りを入力してください。'
                : '読み取れませんでした。画像を見ながら入力できます。'}
            </p>
          </>
        )}
      </div>
      {job.status === 'waiting' ? (
        <button
          type="button"
          onClick={() => retryWaitingJobs()}
          className="min-h-11 shrink-0 px-2 text-xs font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          今すぐ読み取る →
        </button>
      ) : (
        <Link
          href={`/transactions/receipt/${job.captureId}` as Route}
          prefetch={false}
          className="flex min-h-11 shrink-0 items-center px-2 text-xs font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          入力する →
        </Link>
      )}
    </div>
  );
}
