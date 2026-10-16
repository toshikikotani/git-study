'use client';

import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useRef, useState } from 'react';

import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { genreSwatch } from '@/domain/genre-style';
import { subscriptionKeyOf } from '@/domain/subscriptions';
import { fetchAccounts, type AccountOption } from '@/features/transactions/accounts-client';
import {
  clearDraft,
  keepDraft,
  peekDraft,
  type RecordDraft,
} from '@/features/transactions/record-draft';
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
  { value: 'refund', label: '返金' },
] as const;
type Kind = (typeof KINDS)[number]['value'];

/**
 * 記録するを開くときの初期値(明細のカレンダーの「この日に手で記録」など)。
 * error は、保存できなかったときに開き直して見せる理由(入れた値は下書きから戻る、ADR-098)。
 */
export type RecordOptions = { date?: string; kind?: 'expense' | 'income'; error?: string };

// ---- カテゴリと口座を先に読んでおく(開いた瞬間からタイルが並ぶように、ADR-098)------------------
type GenreTile = { id: string; name: string };
let genreCache: readonly GenreTile[] | null = null;
let accountCache: readonly AccountOption[] | null = null;
let loading: Promise<void> | null = null;

/** カテゴリと口座を読んでおく。アプリを開いたときと、記録するを開くたびに呼ぶ(重ねて呼んでも1回)。 */
export function prefetchRecordData(): Promise<void> {
  loading ??= Promise.all([
    fetchQuickEntryGenresAction()
      .then((g) => {
        genreCache = g;
      })
      .catch(() => {}),
    fetchAccounts().then((a) => {
      if (a.length > 0) accountCache = a;
    }),
  ]).then(() => {
    loading = null;
  });
  return loading;
}

const OpenRecordContext = createContext<((options?: RecordOptions) => void) | null>(null);

/** アプリの外枠(AppShell)が、記録するのシートを開く関数を配る。 */
export const OpenRecordProvider = OpenRecordContext.Provider;

/** 記録するのシートを開く。外枠の外(テストなど)では null。 */
export function useOpenRecord(): ((options?: RecordOptions) => void) | null {
  return useContext(OpenRecordContext);
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 「今日 · 10月16日（金）」「明日 · 10月17日（土）」 */
function dateLabel(date: string, today: string): string {
  const [, m, d] = splitDateOnly(date);
  const prefix = date === today ? '今日 · ' : date === addDays(today, 1) ? '明日 · ' : '';
  return `${prefix}${m}月${d}日（${WEEKDAYS[weekdayOf(date)]}）`;
}

/**
 * 記録する(デザイン仕様書の⑤、ADR-091)。手で記録するのはここだけ(ADR-096。旧「手入力」の画面をまとめた)。
 * 支出 / 収入 / 返金、レシートで入力、金額と日付、レシート名(空ならカテゴリ名、ADR-092)、
 * カテゴリ(押して選ぶ・「追加」で足す)、固定費にする、口座(2つ以上あるとき)とメモ。
 * 日付を今日より先にすると「予定」として記録する(使った額には入らない)。返金は、選んだカテゴリの
 * 使った額から差し引く(収入にはならない)。
 * 保存は取り込みと同じ経路(saveImportBatchAction、ADR-033)。口座の既定は1つめの口座。
 */
export function RecordSheet({
  onClose,
  onCamera,
  onFiles,
  canStream,
  initialDate,
  initialKind,
  initialError,
}: {
  onClose: () => void;
  /** 自前のカメラ(連続撮影・写真ライブラリもその中にある)を開く。 */
  onCamera: (mode: 'single' | 'continuous') => void;
  onFiles: (files: File[]) => void;
  canStream: boolean;
  /** 日付の初期値(無ければ今日)。 */
  initialDate?: string | undefined;
  initialKind?: 'expense' | 'income' | undefined;
  /** 保存できなかった理由(開き直したとき)。 */
  initialError?: string | undefined;
}) {
  const router = useRouter();
  const openRecord = useOpenRecord();
  const today = todayJst();
  // 保存せずに閉じた入力(下書き)があれば戻す。カレンダーから日付を指定して開いたら、その日にする。
  const [restored] = useState(() => peekDraft());
  const [kind, setKind] = useState<Kind>(initialKind ?? restored?.kind ?? 'expense');
  const [amount, setAmount] = useState(restored?.amount ?? '');
  const [genreId, setGenreId] = useState<string | null>(restored?.genreId ?? null);
  const [date, setDate] = useState(initialDate ?? restored?.date ?? today);
  const [name, setName] = useState(restored?.name ?? '');
  const [memo, setMemo] = useState(restored?.memo ?? '');
  const [fixed, setFixed] = useState(restored?.fixed ?? false);
  const [genres, setGenres] = useState<readonly GenreTile[]>(genreCache ?? []);
  const [accounts, setAccounts] = useState<readonly AccountOption[]>(accountCache ?? []);
  const [accountId, setAccountId] = useState(restored?.accountId || (accountCache?.[0]?.id ?? ''));
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [showRestored, setShowRestored] = useState(restored !== null && !initialError);

  useEffect(() => {
    void prefetchRecordData().then(() => {
      if (genreCache) setGenres(genreCache);
      if (accountCache) {
        setAccounts(accountCache);
        setAccountId((prev) => prev || (accountCache?.[0]?.id ?? ''));
      }
    });
  }, []);

  // 入れるたびに下書きに残す。保存せずに閉じても(どの閉じ方でも)、次に開くと戻る(ADR-098)。
  const current: RecordDraft = { kind, amount, genreId, date, name, memo, fixed, accountId };
  const finished = useRef(false);
  useEffect(() => {
    if (!finished.current) {
      keepDraft({ kind, amount, genreId, date, name, memo, fixed, accountId });
    }
  }, [kind, amount, genreId, date, name, memo, fixed, accountId]);

  const amountYen = Number(amount.replace(/[^\d]/g, ''));
  const canSave = amountYen > 0;
  const scheduled = date > today;

  const resetForm = () => {
    clearDraft();
    setAmount('');
    setGenreId(null);
    setName('');
    setMemo('');
    setFixed(false);
    setDate(initialDate ?? today);
    setShowRestored(false);
    setError(null);
  };

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

  const selectedGenre = kind === 'income' ? undefined : genres.find((g) => g.id === genreId);
  /** レシート名が空のときに入る名前(入力欄の薄い文字にも出す)。 */
  const fallbackName =
    kind === 'income'
      ? '収入'
      : kind === 'refund'
        ? selectedGenre
          ? `${selectedGenre.name}の返金`
          : '返金'
        : (selectedGenre?.name ?? '手入力');

  // 保存:押したらすぐ閉じ、保存はうしろで続ける(待たせない、ADR-098)。保存できなかったら、入れた値を
  // 下書きに戻して、理由をつけてシートを開き直す。二度押ししても1回だけ。
  const save = () => {
    if (finished.current) return;
    if (!canSave) {
      setError('金額を入れてください。');
      return;
    }
    if (kind === 'refund' && genreId === null) {
      setError('返金は、どのカテゴリの支出から差し引くかを選んでください。');
      return;
    }
    finished.current = true;
    clearDraft();
    hapticFor('save');
    onClose();
    void persist(current);
  };

  const failed = (snapshot: RecordDraft, message: string) => {
    keepDraft(snapshot);
    openRecord?.({ error: message });
  };

  const persist = async (snapshot: RecordDraft) => {
    let account = snapshot.accountId;
    if (account === '') {
      const fetched = await fetchAccounts();
      account = fetched[0]?.id ?? '';
    }
    if (account === '') {
      failed(snapshot, '口座がまだありません。「…」› 口座 から1つ登録してください。');
      return;
    }
    const signed = kind === 'expense' ? -amountYen : amountYen;
    const genre = selectedGenre;
    const label = name.trim() || fallbackName;
    const preview: StoredTransaction = {
      id: 'manual-0',
      accountId: account,
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
      kind: kind === 'refund' ? 'refund' : 'normal',
      source: 'manual',
      fingerprint: fingerprintOf({ occurredOn: date, amountYen: signed, description: label }),
      batchId: null,
      sourceRef: null,
      memo: memo.trim() === '' ? null : memo.trim(),
    };
    let outcome: Awaited<ReturnType<typeof saveImportBatchAction>>;
    try {
      outcome = await saveImportBatchAction([preview], {
        fileName: '手入力',
        source: 'manual',
        accountId: account,
        failedCount: 0,
      });
    } catch {
      failed(snapshot, '保存できませんでした。電波のよい所で、もう一度「保存」を押してください。');
      return;
    }
    if (outcome.error) {
      failed(snapshot, outcome.error);
      return;
    }
    if (fixed && kind === 'expense') {
      await confirmFixedCostAction(subscriptionKeyOf(label, label, signed)).catch(() => {});
    }
    if (outcome.insertedIds.length > 0) {
      const ids = outcome.insertedIds;
      pushUndo(`${label} を記録しました`, async () => {
        const r = await undoReceiptSaveAction(ids);
        if (r.error) return r.error;
        router.refresh();
        return null;
      });
    }
    router.refresh();
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
        {/* 金額が無くても押せる(押したら何が足りないかを出す。黙って効かないボタンにしない、ADR-098) */}
        <button
          type="button"
          onClick={save}
          className="flex min-h-11 items-center justify-self-end text-[17px] font-bold"
          style={{ color: 'var(--accent)', opacity: canSave ? 1 : 0.4 }}
        >
          保存
        </button>
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-xl px-3 py-2 text-[14px] leading-normal"
          style={{ background: 'var(--note)', color: 'var(--over)' }}
        >
          {error}
        </p>
      ) : null}
      {showRestored ? (
        <div
          className="flex items-center justify-between gap-2 rounded-xl px-3 text-[13px]"
          style={{ background: 'var(--note)', color: 'var(--ink-secondary)' }}
        >
          <span>前に入れかけた内容を戻しました</span>
          <button
            type="button"
            onClick={resetForm}
            className="min-h-11 px-1 font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            消す
          </button>
        </div>
      ) : null}

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
            kind === 'expense' && selectedGenre === undefined ? '店名など（任意）' : fallbackName
          }
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-right text-[16px] outline-none"
          style={{ color: 'var(--ink)' }}
        />
      </label>

      {kind !== 'income' ? (
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
      <div className="flex flex-col rounded-2xl" style={{ background: 'var(--surface)' }}>
        {accounts.length >= 2 ? (
          <label className="flex min-h-13 items-center gap-3 px-4">
            <span className="shrink-0 text-[16px]">口座</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-right text-[16px] outline-none"
              style={{ color: 'var(--ink)' }}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label
          className="flex min-h-13 items-center gap-3 px-4"
          style={accounts.length >= 2 ? { borderTop: '1px solid var(--hairline)' } : undefined}
        >
          <span className="shrink-0 text-[16px]">メモ</span>
          <input
            value={memo}
            maxLength={200}
            placeholder="任意"
            onChange={(e) => setMemo(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-right text-[16px] outline-none"
            style={{ color: 'var(--ink)' }}
          />
        </label>
      </div>
      <p className="px-3 text-[12px] leading-normal" style={{ color: 'var(--ink-muted)' }}>
        {kind === 'refund'
          ? '返品・返金は、選んだカテゴリの使った額から差し引かれます（収入にはなりません）。'
          : '日付を先にすると「予定」として記録され、使った額には入りません。'}
      </p>
    </div>
  );
}
