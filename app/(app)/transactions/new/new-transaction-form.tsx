'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Card } from '@/components/ui/card';
import {
  emptyManualValues,
  validateManualEntry,
  type ManualEntryValues,
} from '@/domain/receipt-capture';
import { todayJst } from '@/lib/date';
import { hapticFor } from '@/lib/haptics';
import { pushUndo } from '@/lib/undo';
import { fetchAccounts, type AccountOption } from '@/features/transactions/accounts-client';
import { fetchGenreOptions, type GenreOption } from '@/features/transactions/genres-client';
// `./store` ではなく `./types` から読む(T-7/P10-4)。`store.ts` は
// `next/headers` に依存するため、そこから型だけ import してもクライアント
// バンドルへ引き込まれてビルドエラーになる。
import { fingerprintOf, type StoredTransaction } from '@/features/transactions/types';
import { saveImportBatchAction, undoReceiptSaveAction } from '../actions';
import { ManualEntryForm } from '../manual-entry-form';

/**
 * 明細を手で登録する(レシートなし)。
 *
 * 現金払いなど、CSV・レシート撮影・メール取り込みのどれにも乗らない明細を、その場で1件だけ
 * 記録する最後の逃げ道(設計原則2)。入力の順番は 金額 → ジャンル(アイコンの格子)→ 最近使った店 →
 * 日付 → 口座 → メモ。フォーム部品は、読み取れなかったレシートの手動入力画面(F7)と共通
 * (`ManualEntryForm`)。
 *
 * 保存経路は取り込み画面と共通(ADR-033):`saveImportBatchAction()` へ長さ1の配列を渡すだけ。
 * 保存後は「元に戻す」を出す。登録直後は口座・日付・ジャンルを残し、金額・店名・メモだけ空にして、
 * 続けて次の1件を入力できる(現金払いは何件かまとめて記録することが多い)。
 * `?date=` があればその日、`?type=income` なら収入から始める。
 */
export function NewTransactionForm({
  initialDate,
  initialIncome = false,
  recentStores = [],
}: {
  initialDate: string;
  initialIncome?: boolean;
  /** 最近使った店(候補)。 */
  recentStores?: readonly string[];
}) {
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null);
  const [genreOptions, setGenreOptions] = useState<GenreOption[]>([]);
  const [values, setValues] = useState<ManualEntryValues>(() => emptyManualValues(initialDate));
  const [isIncome, setIsIncome] = useState(initialIncome);
  // 特別費(目標のペース計算から外す)。未来日の予定の支払い(発表会など)にも使う。
  const [kind, setKind] = useState<'normal' | 'special'>('normal');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saved, setSaved] = useState<{ imported: number; duplicates: number } | null>(null);

  useEffect(() => {
    void fetchAccounts().then((fetched) => {
      setAccounts(fetched);
      setValues((v) => ({ ...v, accountId: v.accountId || (fetched[0]?.id ?? '') }));
    });
    void fetchGenreOptions().then(setGenreOptions);
  }, []);

  const errors = validateManualEntry(values, '9999-12-31');

  async function save(): Promise<void> {
    setShowErrors(true);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setSaveError(null);

    const amountYen = (isIncome ? 1 : -1) * (values.amountYen ?? 0);
    const store = values.storeName.trim() === '' ? '手入力' : values.storeName.trim();
    const genre = genreOptions.find((g) => g.id === values.genreId);
    const preview: StoredTransaction = {
      id: 'manual-0',
      accountId: values.accountId,
      occurredOn: values.occurredOn,
      description: store,
      merchantName: store,
      amountYen,
      paymentMethod: 'one_time',
      genreId: values.genreId,
      genreName: genre?.name ?? null,
      classifiedBy: values.genreId ? 'manual' : 'unclassified',
      confidence: null,
      reviewStatus: 'auto_ok',
      mustPay: false,
      kind: isIncome ? 'normal' : kind,
      source: 'manual',
      fingerprint: fingerprintOf({
        occurredOn: values.occurredOn,
        amountYen,
        description: store,
      }),
      batchId: null,
      sourceRef: null,
      memo: values.memo.trim() === '' ? null : values.memo.trim(),
    };

    const outcome = await saveImportBatchAction([preview], {
      fileName: '手入力',
      source: 'manual',
      accountId: values.accountId,
      failedCount: 0,
    });
    setSaving(false);
    if (outcome.error) {
      setSaveError(outcome.error);
      return;
    }
    hapticFor('save');
    setSaved(outcome);
    if (outcome.insertedIds.length > 0) {
      const ids = outcome.insertedIds;
      pushUndo(`${store} を登録しました`, async () => {
        const r = await undoReceiptSaveAction(ids);
        if (r.error === null) setSaved(null);
        return r.error;
      });
    }
    // 口座・日付・ジャンルは残し、金額・店名・メモを空にして次の1件へ。
    setValues((v) => ({ ...v, amountYen: null, storeName: '', memo: '' }));
    setShowErrors(false);
  }

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-3xl leading-tight font-semibold" style={{ color: 'var(--ink)' }}>
          手入力
        </h1>
        <Link
          href="/spending"
          className="flex min-h-11 items-center text-sm"
          style={{ color: 'var(--ink-secondary)' }}
        >
          やめる
        </Link>
      </header>

      <div className="flex gap-2" role="group" aria-label="支出か収入か">
        <button
          type="button"
          aria-pressed={!isIncome}
          onClick={() => setIsIncome(false)}
          className="min-h-11 flex-1 rounded-xl text-sm font-semibold"
          style={{
            background: !isIncome ? 'var(--accent)' : 'var(--surface-raised)',
            color: !isIncome ? 'var(--on-accent)' : 'var(--ink-secondary)',
          }}
        >
          支出
        </button>
        <button
          type="button"
          aria-pressed={isIncome}
          onClick={() => setIsIncome(true)}
          className="min-h-11 flex-1 rounded-xl text-sm font-semibold"
          style={{
            background: isIncome ? 'var(--accent)' : 'var(--surface-raised)',
            color: isIncome ? 'var(--on-accent)' : 'var(--ink-secondary)',
          }}
        >
          収入
        </button>
      </div>

      {accounts !== null && accounts.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
          口座がまだ登録されていません。
          <Link
            href="/accounts"
            className="min-h-11 inline-flex items-center ml-1 font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            先に登録する →
          </Link>
        </p>
      ) : null}

      {saved ? (
        <Card>
          <p className="text-sm" style={{ color: 'var(--ink)' }}>
            登録しました
            {saved.duplicates > 0 ? '(同じ内容が既にあったため重複は除外しました)' : ''}
          </p>
          <Link
            href="/spending"
            className="mt-3 flex min-h-11 items-center text-sm font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            明細を見る →
          </Link>
        </Card>
      ) : null}

      <ManualEntryForm
        variant="quick"
        values={values}
        onChange={(next) => {
          setValues(next);
          setSaved(null);
        }}
        genres={genreOptions}
        accounts={accounts ?? []}
        recentStores={recentStores}
        errors={errors}
        showErrors={showErrors}
      />

      {!isIncome ? (
        <label className="block">
          <span className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            目標の扱い
            {values.occurredOn > todayJst()
              ? '(今日より先の日付は「予定」として、使った額には入りません)'
              : ''}
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'normal' | 'special')}
            className="mt-1 min-h-11 w-full rounded-xl px-3 text-sm"
            style={{
              background: 'var(--surface-raised)',
              color: 'var(--ink)',
              border: '1px solid var(--hairline)',
            }}
          >
            <option value="normal">目標の予算に含める</option>
            <option value="special">特別費として別枠</option>
          </select>
        </label>
      ) : null}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="min-h-12 w-full rounded-2xl text-base font-semibold disabled:opacity-40"
        style={{ background: 'var(--action)', color: 'var(--on-action)' }}
      >
        {saving ? '登録中…' : '登録する'}
      </button>

      {saveError ? (
        <p role="alert" className="text-center text-xs" style={{ color: 'var(--over)' }}>
          {saveError}
        </p>
      ) : null}
    </div>
  );
}
