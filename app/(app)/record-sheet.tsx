'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Segmented } from '@/components/ui/segmented';
import { subscriptionKeyOf } from '@/domain/subscriptions';
import { fetchAccounts } from '@/features/transactions/accounts-client';
import { fingerprintOf, type StoredTransaction } from '@/features/transactions/types';
import { addDays, splitDateOnly, todayJst, weekdayOf } from '@/lib/date';
import { hapticFor } from '@/lib/haptics';
import { pushUndo } from '@/lib/undo';
import { confirmFixedCostAction } from './reports/fixed-cost-actions';
import { saveImportBatchAction, undoReceiptSaveAction } from './transactions/actions';
import { fetchQuickEntryGenresAction } from './transactions/new/actions';

const KINDS = [
  { value: 'expense', label: '支出' },
  { value: 'income', label: '収入' },
  { value: 'scheduled', label: '予定' },
] as const;
type Kind = (typeof KINDS)[number]['value'];

/** カテゴリを最初に出す数(よく使う順)。残りは「すべて」で開く。 */
const TOP_GENRES = 5;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 「今日 · 10月16日（金）」 */
function dateLabel(date: string, today: string): string {
  const [, m, d] = splitDateOnly(date);
  const prefix = date === today ? '今日 · ' : date === addDays(today, 1) ? '明日 · ' : '';
  return `${prefix}${m}月${d}日（${WEEKDAYS[weekdayOf(date)]}）`;
}

/**
 * 記録する(デザイン仕様書の「記録する」、ADR-090):キャンセル / 記録する / 保存、支出・収入・予定、
 * レシートを撮る・写真から選ぶ、または手で入力(金額・カテゴリ・日付・店・メモ・毎月の固定費)。
 * 保存は取り込みと同じ経路(saveImportBatchAction、ADR-033)。口座は1つめの口座。
 */
export function RecordSheet({
  onClose,
  onCamera,
  onFiles,
  canStream,
  onNavigate,
}: {
  onClose: () => void;
  /** 自前のカメラ(連続撮影もできる)を開く。 */
  onCamera: (mode: 'single' | 'continuous') => void;
  onFiles: (files: File[]) => void;
  canStream: boolean;
  onNavigate: (href: string) => void;
}) {
  const router = useRouter();
  const today = todayJst();
  const [kind, setKind] = useState<Kind>('expense');
  const [amount, setAmount] = useState('');
  const [genreId, setGenreId] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState('');
  const [fixed, setFixed] = useState(false);
  const [genres, setGenres] = useState<readonly { id: string; name: string }[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchQuickEntryGenresAction().then(setGenres);
    void fetchAccounts().then((accounts) => setAccountId(accounts[0]?.id ?? ''));
  }, []);

  const changeKind = (next: Kind) => {
    setKind(next);
    // 予定は今日より先の日付だけ。今日のままなら明日にする。
    if (next === 'scheduled' && date <= today) setDate(addDays(today, 1));
    if (next !== 'scheduled' && date > today) setDate(today);
  };

  const amountYen = Number(amount.replace(/[^\d]/g, ''));
  const shownGenres = showAll ? genres : genres.slice(0, TOP_GENRES);
  const canSave = amountYen > 0 && accountId !== '' && !saving;

  const save = async () => {
    if (!canSave) return;
    if (kind === 'scheduled' && date <= today) {
      setError('予定は明日以降の日付にしてください。');
      return;
    }
    if (kind !== 'scheduled' && date > today) {
      setError('今日より先の日付は「予定」で記録してください。');
      return;
    }
    setSaving(true);
    setError(null);
    const signed = kind === 'income' ? amountYen : -amountYen;
    const store = memo.trim() === '' ? '手入力' : memo.trim();
    const genre = genres.find((g) => g.id === genreId);
    const preview: StoredTransaction = {
      id: 'manual-0',
      accountId,
      occurredOn: date,
      description: store,
      merchantName: store,
      amountYen: signed,
      paymentMethod: 'one_time',
      genreId: kind === 'income' ? null : genreId,
      genreName: kind === 'income' ? null : (genre?.name ?? null),
      classifiedBy: genreId && kind !== 'income' ? 'manual' : 'unclassified',
      confidence: null,
      reviewStatus: 'auto_ok',
      mustPay: false,
      kind: 'normal',
      source: 'manual',
      fingerprint: fingerprintOf({ occurredOn: date, amountYen: signed, description: store }),
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
    if (fixed && kind !== 'income') {
      await confirmFixedCostAction(subscriptionKeyOf(store, store, signed));
    }
    setSaving(false);
    hapticFor('save');
    if (outcome.insertedIds.length > 0) {
      const ids = outcome.insertedIds;
      pushUndo(`${store} を記録しました`, async () => {
        const r = await undoReceiptSaveAction(ids);
        if (r.error) return r.error;
        router.refresh();
        return null;
      });
    }
    setAmount('');
    setMemo('');
    setFixed(false);
    router.refresh();
    onClose();
  };

  const tile =
    'flex min-h-24 cursor-pointer flex-col items-start justify-between rounded-[18px] px-4 py-4 text-left';

  return (
    <div className="flex flex-col gap-4" style={{ color: 'var(--ink)' }}>
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
          className="flex min-h-11 items-center justify-self-end text-[17px] font-semibold disabled:opacity-40"
          style={{ color: 'var(--accent)' }}
        >
          {saving ? '保存中' : '保存'}
        </button>
      </div>

      <Segmented
        value={kind}
        options={KINDS}
        onChange={changeKind}
        label="種類"
        className="grid w-full grid-cols-3"
      />

      <div className="grid grid-cols-2 gap-3">
        {canStream ? (
          <button
            type="button"
            onClick={() => onCamera('single')}
            className={tile}
            style={{ background: 'var(--action)', color: 'var(--on-action)' }}
          >
            <CameraIcon />
            <span className="text-[16px] font-semibold">レシートを撮る</span>
          </button>
        ) : (
          <label
            className={tile}
            style={{ background: 'var(--action)', color: 'var(--on-action)' }}
          >
            <CameraIcon />
            <span className="text-[16px] font-semibold">レシートを撮る</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                onFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </label>
        )}
        <label className={tile} style={{ background: 'var(--surface)', color: 'var(--ink)' }}>
          <PhotoIcon />
          <span className="text-[16px] font-semibold">写真から選ぶ</span>
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
      </div>

      <span className="px-1 pt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        または手で入力
      </span>
      <div className="-mt-2 flex flex-col rounded-2xl" style={{ background: 'var(--surface)' }}>
        <label className="flex items-baseline gap-2 px-4 py-3">
          <span className="w-14 shrink-0 text-[15px]" style={{ color: 'var(--ink-muted)' }}>
            金額
          </span>
          <input
            inputMode="numeric"
            placeholder="0"
            value={amount}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^\d]/g, '');
              setAmount(digits === '' ? '' : Number(digits).toLocaleString('ja-JP'));
            }}
            aria-label="金額(円)"
            className="tabular min-w-0 flex-1 bg-transparent text-right text-[34px] font-bold outline-none"
            style={{ color: 'var(--ink)' }}
          />
          <span className="text-[20px] font-semibold">円</span>
        </label>
        <Divider />
        {kind !== 'income' ? (
          <>
            <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
              <span className="text-[15px]" style={{ color: 'var(--ink-muted)' }}>
                カテゴリ
              </span>
              <div className="flex flex-wrap gap-2">
                {shownGenres.map((g) => {
                  const on = g.id === genreId;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setGenreId(on ? null : g.id)}
                      className={`min-h-11 rounded-full px-4 text-[14px] ${on ? 'font-semibold' : ''}`}
                      style={{
                        background: on ? 'var(--accent)' : 'var(--plane)',
                        color: on ? 'var(--on-accent)' : 'var(--ink)',
                      }}
                    >
                      {g.name}
                    </button>
                  );
                })}
                {genres.length > TOP_GENRES && !showAll ? (
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="min-h-11 rounded-full px-4 text-[14px]"
                    style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
                  >
                    すべて
                  </button>
                ) : null}
              </div>
            </div>
            <Divider />
          </>
        ) : null}
        <label className="relative flex min-h-13 items-center justify-between px-4 text-[15px]">
          <span style={{ color: 'var(--ink-muted)' }}>日付</span>
          <span className="tabular">{dateLabel(date, today)}</span>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="日付"
            className="absolute inset-0 opacity-0"
          />
        </label>
        <Divider />
        <label className="flex min-h-13 items-center gap-2 px-4">
          <span className="w-14 shrink-0 text-[15px]" style={{ color: 'var(--ink-muted)' }}>
            店・メモ
          </span>
          <input
            placeholder="任意"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-right text-[15px] outline-none"
            style={{ color: 'var(--ink)' }}
          />
        </label>
        {kind !== 'income' ? (
          <>
            <Divider />
            <label className="flex min-h-14 items-center justify-between gap-3 px-4 text-[15px]">
              <span className="flex flex-col">
                <span>毎月の固定費にする</span>
                <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                  家賃・保険・サブスクなど
                </span>
              </span>
              <Switch checked={fixed} onChange={setFixed} label="毎月の固定費にする" />
            </label>
          </>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="px-1 text-[13px]" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}

      <nav
        aria-label="ほかの記録のしかた"
        className="flex flex-wrap gap-x-4 px-1 text-[13px]"
        style={{ color: 'var(--accent)' }}
      >
        {canStream ? (
          <button type="button" onClick={() => onCamera('continuous')} className="min-h-11">
            何枚か続けて撮る
          </button>
        ) : null}
        {(
          [
            ['/transactions/capture-text', '話して・文字で記録'],
            ['/transactions/capture-screenshot', 'スクショから記録'],
            ['/transactions/new', 'くわしく入力(口座・品目・返金)'],
          ] as const
        ).map(([href, label]) => (
          <Link
            key={href}
            href={href as Route}
            prefetch={false}
            onPointerDown={() => onNavigate(href)}
            onClick={onClose}
            className="flex min-h-11 items-center"
          >
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function Divider() {
  return <div className="ml-4 h-px" style={{ background: 'var(--hairline)' }} />;
}

/** iOS のスイッチの形(51×31)。 */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <span
      className="relative h-8 w-13 shrink-0 rounded-full transition-colors"
      style={{ background: checked ? 'var(--income)' : 'var(--field)' }}
    >
      <span
        aria-hidden
        className="absolute top-0.5 size-7 rounded-full transition-[left]"
        style={{
          left: checked ? 22 : 2,
          background: '#ffffff',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
        }}
      />
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="absolute inset-0 m-0 cursor-pointer opacity-0"
      />
    </span>
  );
}

function CameraIcon() {
  return (
    <svg
      aria-hidden
      width="28"
      height="28"
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
}

function PhotoIcon() {
  return (
    <svg
      aria-hidden
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M20 16l-5-5-8 8" />
    </svg>
  );
}
