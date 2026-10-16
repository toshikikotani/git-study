'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { genreSwatch } from '@/domain/genre-style';
import { subscriptionKeyOf } from '@/domain/subscriptions';
import { fetchAccounts } from '@/features/transactions/accounts-client';
import { fingerprintOf, type StoredTransaction } from '@/features/transactions/types';
import { addDays, splitDateOnly, todayJst, weekdayOf } from '@/lib/date';
import { hapticFor } from '@/lib/haptics';
import { pushUndo } from '@/lib/undo';
import { confirmFixedCostAction } from './reports/fixed-cost-actions';
import { createCategoryAction } from './spending/category/actions';
import { saveImportBatchAction, undoReceiptSaveAction } from './transactions/actions';
import { fetchQuickEntryGenresAction } from './transactions/new/actions';

const KINDS = [
  { value: 'expense', label: '支出' },
  { value: 'income', label: '収入' },
] as const;
type Kind = (typeof KINDS)[number]['value'];

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 「今日 · 10月16日（金）」「明日 · 10月17日（土）」 */
function dateLabel(date: string, today: string): string {
  const [, m, d] = splitDateOnly(date);
  const prefix = date === today ? '今日 · ' : date === addDays(today, 1) ? '明日 · ' : '';
  return `${prefix}${m}月${d}日（${WEEKDAYS[weekdayOf(date)]}）`;
}

/**
 * 記録する(デザイン仕様書の⑤、ADR-091):できるのは3つだけ ── 記録する・カテゴリを足す・固定費にする。
 * 支出 / 収入、レシートで入力、金額と日付、レシート名(空ならカテゴリ名、ADR-092)、
 * カテゴリ(押して選ぶ・「追加」で足す)、固定費にする。
 * 日付を今日より先にすると「予定」として記録する(使った額には入らない)。
 * 保存は取り込みと同じ経路(saveImportBatchAction、ADR-033)。口座は1つめの口座。
 */
export function RecordSheet({
  onClose,
  onCamera,
  onFiles,
  canStream,
}: {
  onClose: () => void;
  /** 自前のカメラ(連続撮影・写真ライブラリもその中にある)を開く。 */
  onCamera: (mode: 'single' | 'continuous') => void;
  onFiles: (files: File[]) => void;
  canStream: boolean;
}) {
  const router = useRouter();
  const today = todayJst();
  const [kind, setKind] = useState<Kind>('expense');
  const [amount, setAmount] = useState('');
  const [genreId, setGenreId] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [name, setName] = useState('');
  const [fixed, setFixed] = useState(false);
  const [genres, setGenres] = useState<readonly { id: string; name: string }[]>([]);
  const [accountId, setAccountId] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchQuickEntryGenresAction().then(setGenres);
    void fetchAccounts().then((accounts) => setAccountId(accounts[0]?.id ?? ''));
  }, []);

  const amountYen = Number(amount.replace(/[^\d]/g, ''));
  const canSave = amountYen > 0 && accountId !== '' && !saving;
  const scheduled = date > today;

  const addCategory = async () => {
    const name = newName.trim();
    if (name === '') return;
    setError(null);
    const result = await createCategoryAction(name);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    const next = await fetchQuickEntryGenresAction();
    setGenres(next);
    setGenreId(next.find((g) => g.name === name)?.id ?? null);
    setNewName('');
    setAdding(false);
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const signed = kind === 'income' ? amountYen : -amountYen;
    const genre = kind === 'income' ? undefined : genres.find((g) => g.id === genreId);
    const label = name.trim() || (kind === 'income' ? '収入' : (genre?.name ?? '手入力'));
    const preview: StoredTransaction = {
      id: 'manual-0',
      accountId,
      occurredOn: date,
      description: label,
      merchantName: label,
      amountYen: signed,
      paymentMethod: 'one_time',
      genreId: genre?.id ?? null,
      genreName: genre?.name ?? null,
      classifiedBy: genre ? 'manual' : 'unclassified',
      confidence: null,
      reviewStatus: 'auto_ok',
      mustPay: false,
      kind: 'normal',
      source: 'manual',
      fingerprint: fingerprintOf({ occurredOn: date, amountYen: signed, description: label }),
      batchId: null,
      sourceRef: null,
      memo: null,
    };
    const outcome = await saveImportBatchAction([preview], {
      fileName: '手入力',
      source: 'manual',
      accountId,
      failedCount: 0,
    });
    if (outcome.error) {
      setSaving(false);
      setError(outcome.error);
      return;
    }
    if (fixed && kind === 'expense') {
      await confirmFixedCostAction(subscriptionKeyOf(label, label, signed));
    }
    setSaving(false);
    hapticFor('save');
    if (outcome.insertedIds.length > 0) {
      const ids = outcome.insertedIds;
      pushUndo(`${label} を記録しました`, async () => {
        const r = await undoReceiptSaveAction(ids);
        if (r.error) return r.error;
        router.refresh();
        return null;
      });
    }
    setAmount('');
    setName('');
    setFixed(false);
    router.refresh();
    onClose();
  };

  const receiptButton =
    'flex min-h-11 items-center gap-2 rounded-full px-3 text-[13px] font-semibold';
  const receiptStyle = { background: 'var(--plane)', color: 'var(--ink-secondary)' } as const;
  const cameraIcon = (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );

  return (
    <div className="flex flex-col gap-3" style={{ color: 'var(--ink)' }}>
      <div className="-mt-1 grid grid-cols-[1fr_auto_1fr] items-center">
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-11 items-center justify-self-start text-[17px]"
          style={{ color: 'var(--accent)' }}
        >
          キャンセル
        </button>
        <span className="text-[17px] font-semibold">記録する</span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          className="flex min-h-11 items-center justify-self-end text-[17px] font-bold disabled:opacity-40"
          style={{ color: 'var(--accent)' }}
        >
          {saving ? '保存中' : '保存'}
        </button>
      </div>

      <section
        className="flex flex-col gap-1 rounded-[20px] px-4 pt-3 pb-4"
        style={{ background: 'var(--surface)' }}
      >
        <div className="flex items-center justify-between gap-2">
          <Segmented value={kind} options={KINDS} onChange={setKind} label="種類" />
          {canStream ? (
            <button
              type="button"
              onClick={() => onCamera('single')}
              className={receiptButton}
              style={receiptStyle}
            >
              {cameraIcon}
              レシートで入力
            </button>
          ) : (
            <label className={`cursor-pointer ${receiptButton}`} style={receiptStyle}>
              {cameraIcon}
              レシートで入力
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  onFiles(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
        <label className="flex items-baseline justify-center gap-2 pt-3">
          <span className="sr-only">金額</span>
          <input
            inputMode="numeric"
            placeholder="0"
            value={amount}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^\d]/g, '');
              setAmount(digits === '' ? '' : Number(digits).toLocaleString('ja-JP'));
            }}
            aria-label="金額(円)"
            className="tabular w-56 bg-transparent text-right text-[48px] font-bold outline-none"
            style={{ color: 'var(--ink)' }}
          />
          <span className="text-[24px] font-semibold">円</span>
        </label>
        <label
          className="relative flex min-h-11 items-center justify-center self-center rounded-full px-3 text-[13px]"
          style={{ color: scheduled ? 'var(--state-caution)' : 'var(--ink-muted)' }}
        >
          <span className="tabular">
            {dateLabel(date, today)}
            {scheduled ? ' · 予定' : ''}
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="日付"
            className="absolute inset-0 opacity-0"
          />
        </label>
      </section>

      <label
        className="flex min-h-13 items-center gap-3 rounded-2xl px-4"
        style={{ background: 'var(--surface)' }}
      >
        <span className="shrink-0 text-[16px]">レシート名</span>
        <input
          value={name}
          maxLength={60}
          placeholder={
            kind === 'income'
              ? '収入'
              : (genres.find((g) => g.id === genreId)?.name ?? '店名など（任意）')
          }
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-right text-[16px] outline-none"
          style={{ color: 'var(--ink)' }}
        />
      </label>

      {kind === 'expense' ? (
        <section
          className="flex flex-col gap-3 rounded-[20px] px-3 py-3"
          style={{ background: 'var(--surface)' }}
        >
          <span className="px-1 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
            カテゴリ
          </span>
          <div className="grid grid-cols-4 gap-2">
            {genres.map((g) => {
              const on = g.id === genreId;
              const color = genreSwatch(g.name);
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setGenreId(on ? null : g.id)}
                  className="flex min-h-[76px] flex-col items-center justify-center gap-2 rounded-[14px] px-1 py-2"
                  style={{
                    background: on ? 'var(--note)' : 'var(--surface)',
                    boxShadow: on
                      ? 'inset 0 0 0 2px var(--accent)'
                      : 'inset 0 0 0 1px var(--hairline)',
                    color: 'var(--ink)',
                  }}
                >
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-full text-[15px] font-bold"
                    style={{
                      background: `color-mix(in srgb, ${color} 18%, var(--surface))`,
                      color,
                    }}
                  >
                    {g.name.charAt(0)}
                  </span>
                  <span className="line-clamp-2 text-center text-[12px] leading-tight">
                    {g.name}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex min-h-[76px] flex-col items-center justify-center gap-2 rounded-[14px]"
              style={{
                border: '1.5px dashed var(--bar-quiet)',
                background: 'var(--surface)',
                color: 'var(--accent)',
              }}
            >
              <svg
                aria-hidden
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="text-[12px] font-semibold">追加</span>
            </button>
          </div>
          {adding ? (
            <div className="flex items-center gap-2 px-1 pt-1">
              <label
                className="flex h-11 flex-1 items-center rounded-xl px-3"
                style={{ background: 'var(--plane)' }}
              >
                <span className="sr-only">新しいカテゴリ名</span>
                <input
                  value={newName}
                  maxLength={20}
                  placeholder="新しいカテゴリ名"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void addCategory();
                  }}
                  className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
                  style={{ color: 'var(--ink)' }}
                />
              </label>
              <button
                type="button"
                onClick={() => void addCategory()}
                disabled={newName.trim() === ''}
                className="min-h-11 rounded-xl px-4 text-[15px] font-semibold disabled:opacity-40"
                style={{ background: 'var(--action)', color: 'var(--on-action)' }}
              >
                追加
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {kind === 'expense' ? (
        <div className="rounded-2xl" style={{ background: 'var(--surface)' }}>
          <label className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
            <span className="flex flex-col">
              <span className="text-[16px]">固定費にする</span>
              <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                毎月の家賃・保険・サブスクなど
              </span>
            </span>
            <Switch checked={fixed} onChange={setFixed} label="固定費にする" />
          </label>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="px-1 text-[13px]" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
      <p className="px-3 text-[12px] leading-normal" style={{ color: 'var(--ink-muted)' }}>
        日付を先にすると「予定」として記録され、使った額には入りません。
      </p>
    </div>
  );
}
