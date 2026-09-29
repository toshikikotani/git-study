'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { ReceiptConfirm, type ReceiptConfirmSave } from './receipt-confirm';
import {
  recordGenreCorrectionAction,
  saveImportBatchAction,
  undoReceiptSaveAction,
} from '../actions';
import { ensureDefaultAccountAction } from '../../accounts/actions';
import { loadGoalSnapshotAction } from '../../plan/actions';
import type { GoalSnapshot } from '@/domain/goal-impact';
import { formatYen } from '@/domain/money';
import {
  enqueueReceiptFiles,
  removeReceiptJob,
  useReceiptJobs,
  type ReceiptJob,
} from '@/features/import/receipt-queue';
import { fetchAccounts, type AccountOption } from '@/features/transactions/accounts-client';
import { fetchGenreOptions, type GenreOption } from '@/features/transactions/genres-client';

/**
 * レシートの確認画面(撮影 → 読み取り → 確認 → 保存)。
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

type Toast = { message: string; ids: string[]; undoing: boolean; error: string | null };

export default function ReceiptPage() {
  const jobs = useReceiptJobs();
  const [genres, setGenres] = useState<GenreOption[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null);
  const [accountId, setAccountId] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saved, setSaved] = useState<ReadonlyMap<string, string>>(new Map());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  // 目標があるとき、保存前の影響と保存後のひと言に使う。
  const [goal, setGoal] = useState<{ snapshot: GoalSnapshot; today: string } | null>(null);

  useEffect(() => {
    void fetchGenreOptions().then(setGenres);
    void loadGoalSnapshotAction().then((r) =>
      setGoal(r.snapshot ? { snapshot: r.snapshot, today: r.today } : null),
    );
  }, []);

  useEffect(() => {
    void fetchAccounts().then(async (fetched) => {
      if (fetched.length > 0) {
        setAccounts(fetched);
        setAccountId((current) => current || fetched[0]!.id);
        return;
      }
      const result = await ensureDefaultAccountAction();
      if ('account' in result) {
        setAccounts([result.account]);
        setAccountId((current) => current || result.account.id);
      } else {
        setAccounts([]);
      }
    });
  }, []);

  const save = async (job: ReceiptJob, index: number, input: ReceiptConfirmSave) => {
    const key = `${job.id}:${index}`;
    setSavingKey(key);
    setSaveError(null);

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
    setSavingKey(null);
    if (outcome.error) {
      setSaveError(outcome.error);
      return;
    }

    // 直したジャンルは、履歴へ即座に反映する(次のレシートから効く)。
    void Promise.all(
      input.corrections.map((c) =>
        recordGenreCorrectionAction({
          storeName: input.storeName,
          itemName: c.itemName,
          genreId: c.genreId,
        }),
      ),
    );

    const label = `${input.storeName} ${formatYen(-plan.transaction.amountYen)}`;
    setSaved((prev) => new Map(prev).set(key, label));
    setToast({
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
    const allSaved = job.parsed.every((_, i) => i === index || saved.has(`${job.id}:${i}`));
    if (allSaved) window.setTimeout(() => removeReceiptJob(job.id), 800);
  };

  const undo = async () => {
    if (!toast) return;
    setToast({ ...toast, undoing: true });
    const result = await undoReceiptSaveAction(toast.ids);
    if (result.error) {
      setToast({ ...toast, undoing: false, error: result.error });
      return;
    }
    setSaved(new Map());
    setToast(null);
  };

  const reading = jobs.filter((j) => j.status === 'reading');
  const pending = useMemo(() => jobs.filter((j) => j.status !== 'reading'), [jobs]);

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          レシートを確認
        </h1>
        <Link href="/spending" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          家計簿へ戻る
        </Link>
      </header>

      {accounts !== null && accounts.length > 1 ? (
        <label className="block">
          <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            口座
          </span>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="mt-1 w-full rounded-xl px-3 py-2 text-sm"
            style={{
              background: 'var(--plane)',
              color: 'var(--ink)',
              border: '1px solid var(--hairline)',
            }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {accounts !== null && accounts.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--over)' }}>
          口座を用意できませんでした。時間をおいてから開き直してください。
          <Link href="/accounts" className="ml-1 font-semibold underline">
            口座を登録する
          </Link>
        </p>
      ) : null}

      {/* 撮る・選ぶ。撮影は読み取りを待たず、キューへ入れてすぐ次を撮れる。 */}
      <div
        className="rounded-2xl border border-dashed px-4 py-4 text-center"
        style={{ borderColor: 'var(--hairline)' }}
      >
        <div className="flex justify-center gap-3">
          <label
            className="label-text cursor-pointer px-6 py-2.5"
            style={{
              borderRadius: 'var(--radius-full)',
              background: 'var(--accent)',
              color: 'var(--on-accent)',
            }}
          >
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="sr-only"
              onChange={(e) => {
                enqueueReceiptFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            撮る
          </label>
          <label
            className="label-text cursor-pointer px-6 py-2.5"
            style={{
              borderRadius: 'var(--radius-full)',
              border: '1px solid var(--hairline)',
              color: 'var(--accent)',
            }}
          >
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                enqueueReceiptFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            ライブラリから選ぶ
          </label>
        </div>
      </div>

      {saveError ? (
        <p role="alert" className="text-xs" style={{ color: 'var(--over)' }}>
          {saveError}
        </p>
      ) : null}

      {/* 空状態 */}
      {jobs.length === 0 ? (
        <p
          className="px-1 text-center text-sm leading-relaxed"
          style={{ color: 'var(--ink-muted)' }}
        >
          レシートを撮る・選ぶと、ここに読み取り結果が出ます。
          <br />
          撮ったあとは待たずに、そのまま次のレシートを撮れます。
        </p>
      ) : null}

      {/* 読み取り中:スケルトン(撮影をブロックしない) */}
      {reading.map((job) => (
        <div
          key={job.id}
          role="status"
          aria-label="読み取り中"
          className="flex items-center gap-3 rounded-2xl p-3"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={job.previewUrl} alt="" className="size-14 rounded-lg object-cover" />
          <div className="min-w-0 flex-1 space-y-2">
            <div
              className="h-3 w-2/3 animate-pulse rounded"
              style={{ background: 'var(--hairline)' }}
            />
            <div
              className="h-3 w-1/3 animate-pulse rounded"
              style={{ background: 'var(--hairline)' }}
            />
          </div>
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            読み取り中…
          </span>
        </div>
      ))}

      {pending.map((job) =>
        job.status === 'error' ? (
          <div
            key={job.id}
            role="alert"
            className="flex items-center gap-3 rounded-2xl p-3"
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
              className="text-xs font-semibold"
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
                saving={savingKey === `${job.id}:${index}`}
                savedLabel={saved.get(`${job.id}:${index}`) ?? null}
                goal={goal}
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
            {toast.ids.length > 0 && toast.error === null ? (
              <button
                type="button"
                onClick={() => void undo()}
                disabled={toast.undoing}
                className="font-semibold underline disabled:opacity-50"
              >
                元に戻す
              </button>
            ) : null}
            <button type="button" aria-label="閉じる" onClick={() => setToast(null)}>
              ×
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}
