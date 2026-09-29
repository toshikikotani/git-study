'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Card } from '@/components/ui/card';
import { todayJst } from '@/lib/date';
import { fetchAccounts, type AccountOption } from '@/features/transactions/accounts-client';
import { fetchGenreOptions } from '@/features/transactions/genres-client';
// `./store` ではなく `./types` から読む(T-7/P10-4)。`store.ts` は
// `next/headers` に依存するため、そこから型だけ import してもクライアント
// バンドルへ引き込まれてビルドエラーになる。
import { fingerprintOf, type StoredTransaction } from '@/features/transactions/types';
import { saveImportBatchAction } from '../actions';

/**
 * 明細を手で登録する(本人発案「手で登録したい」)。
 *
 * ── これは主経路ではない ────────────────────────────────────
 * 設計原則2「記録の手間を最小化。手入力は例外」はここでも同じ
 * (`paste/page.tsx` のコメント参照)。CSV・レシート撮影・Gmail自動取込・
 * LINE受信のどれにも乗らない明細(現金払いなど)を、その場で1件だけ
 * 記録するための最後の逃げ道という位置づけ。
 *
 * ── なぜプレビュー画面を挟まないのか ──────────────────────────
 * CSV取り込み・メール貼り付けは複数行を機械的に解析するため「合っているか
 * 確認してから確定」という一手間が要るが、ここは本人が直接入力した1件を
 * 保存するだけなので、フォームの入力欄そのものが確認画面を兼ねる。
 *
 * ── 保存経路は取り込み画面と共通(ADR-033) ───────────────────────
 * 新しい保存関数は作らず、既存の `saveImportBatchAction()` へ長さ1の配列を
 * 渡すだけ。`source: 'manual'` は LINE受信・メール貼り付け・レシート撮影と
 * 同じ値(「本人が確認して確定した」経路という意味。完全自動の
 * Gmail・CSVと区別する)。分類はルールに通さず、本人が選んだカテゴリを
 * そのまま `classifiedBy: 'manual'` として保存する——1件だけの入力に
 * ルールマッチングを挟む意味が薄いため。
 *
 * ── 日付の初期値(本人発案) ──────────────────────────────────
 * 家計簿のカレンダーで日付を押して開いたときは、その日を日付の初期値にする
 * (`page.tsx` が URL の `date` を検証して `initialDate` に渡す)。指定が無ければ今日。
 *
 * ── 保存後もフォームを保持する ────────────────────────────────
 * 現金払いは何件かまとめて記録したいことが多い(同じ日に複数の買い物)。
 * 登録直後は口座・日付・カテゴリを残し、金額・摘要だけ空にして次の1件を
 * すぐ入力できるようにした。
 */
export function NewTransactionForm({
  initialDate,
  initialIncome = false,
}: {
  initialDate: string;
  /** 「収入を登録」から開いたときは収入から始める。 */
  initialIncome?: boolean;
}) {
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null);
  const [accountId, setAccountId] = useState('');
  const [genreOptions, setGenreOptions] = useState<{ id: string; name: string }[]>([]);

  const [occurredOn, setOccurredOn] = useState(initialDate);
  const [isIncome, setIsIncome] = useState(initialIncome);
  // 特別費(目標のペース計算から外す)。未来日の予定の支払い(発表会など)にも使う。
  const [kind, setKind] = useState<'normal' | 'special'>('normal');
  const [amountYenInput, setAmountYenInput] = useState('');
  // 店名とメモは別の入力欄(既存の「A・B」「A/B」形式のデータは変換せずそのまま表示する)。
  const [description, setDescription] = useState('');
  const [memo, setMemo] = useState('');
  const [genreId, setGenreId] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ imported: number; duplicates: number } | null>(null);

  // 口座(M6-2)。取得できたら最初の1件を既定にする(選び直せる)
  useEffect(() => {
    void fetchAccounts().then((fetched) => {
      setAccounts(fetched);
      setAccountId((current) => current || (fetched[0]?.id ?? ''));
    });
  }, []);

  // ジャンル一覧(ADR-057)。取り込み時にAIで確定させることはしない
  // (本人が選ぶか、後からAIジャンル分類にまとめて任せる)。
  useEffect(() => {
    void fetchGenreOptions().then(setGenreOptions);
  }, []);

  const canSave =
    accountId !== '' &&
    occurredOn !== '' &&
    Number(amountYenInput) > 0 &&
    description.trim() !== '';

  async function save(): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);

    const amountYen = (isIncome ? 1 : -1) * Number(amountYenInput);
    const trimmedDescription = description.trim();
    const preview: StoredTransaction = {
      id: 'manual-0',
      accountId,
      occurredOn,
      description: trimmedDescription,
      merchantName: trimmedDescription,
      amountYen,
      paymentMethod: 'one_time',
      genreId: genreId || null,
      genreName: genreId ? (genreOptions.find((g) => g.id === genreId)?.name ?? null) : null,
      classifiedBy: genreId ? 'manual' : 'unclassified',
      confidence: null,
      reviewStatus: 'auto_ok',
      mustPay: false,
      kind: isIncome ? 'normal' : kind,
      source: 'manual',
      fingerprint: fingerprintOf({
        occurredOn,
        amountYen,
        description: trimmedDescription,
      }),
      batchId: null,
      sourceRef: null,
      memo: memo.trim() === '' ? null : memo.trim(),
    };

    const outcome = await saveImportBatchAction([preview], {
      fileName: '手入力',
      source: 'manual',
      accountId,
      failedCount: 0,
    });
    setSaving(false);
    if (outcome.error) {
      setSaveError(outcome.error);
      return;
    }
    setSaved(outcome);
    setAmountYenInput('');
    setDescription('');
    setMemo('');
  }

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          明細を手で登録する
        </h1>
        <Link href="/spending" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          やめる
        </Link>
      </header>

      {/* 主経路ではないことを画面で明示する(paste/page.tsxと同じ配慮)。 */}
      <div
        className="rounded-2xl p-4"
        style={{ background: 'var(--accent-track)', boxShadow: 'var(--card-shadow)' }}
      >
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          現金払いなど、CSV・レシート撮影・メール取り込みのどれにも乗らない
          明細を、その場で1件だけ記録します。
        </p>
      </div>

      {saved ? (
        <Card>
          <p className="text-sm" style={{ color: 'var(--ink)' }}>
            登録しました
            {saved.duplicates > 0 ? '(同じ内容が既にあったため重複は除外しました)' : ''}
          </p>
          <Link
            href="/spending"
            className="mt-4 block w-full rounded-full py-3 text-center text-sm font-semibold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            明細を見る
          </Link>
        </Card>
      ) : null}

      {/* 口座(M6-2) */}
      <Card>
        <label
          className="text-[11px] font-medium tracking-[0.08em] uppercase"
          style={{ color: 'var(--ink-muted)' }}
        >
          口座
        </label>
        {accounts === null ? (
          <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
            読み込んでいます…
          </p>
        ) : accounts.length === 0 ? (
          <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            口座がまだ登録されていません。
            <Link
              href="/accounts"
              className="ml-1 font-semibold underline decoration-dotted underline-offset-4"
              style={{ color: 'var(--accent)' }}
            >
              先に登録する →
            </Link>
          </p>
        ) : (
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="mt-2 w-full rounded-xl px-3 py-2 text-sm"
            style={{
              background: 'var(--plane)',
              color: 'var(--ink)',
              border: '1px solid var(--hairline)',
            }}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        )}
      </Card>

      <Card>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setIsIncome(false)}
            className="flex-1 rounded-xl py-2 text-sm font-semibold"
            style={{
              background: !isIncome ? 'var(--accent)' : 'var(--plane)',
              color: !isIncome ? '#fff' : 'var(--ink-secondary)',
            }}
          >
            支出
          </button>
          <button
            type="button"
            onClick={() => setIsIncome(true)}
            className="flex-1 rounded-xl py-2 text-sm font-semibold"
            style={{
              background: isIncome ? 'var(--income)' : 'var(--plane)',
              color: isIncome ? '#fff' : 'var(--ink-secondary)',
            }}
          >
            収入
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          <input
            type="date"
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
            className="min-w-0 flex-1 rounded-xl px-3 py-2 text-sm"
            style={{
              background: 'var(--plane)',
              color: 'var(--ink)',
              border: '1px solid var(--hairline)',
            }}
          />
          <input
            type="text"
            inputMode="numeric"
            value={amountYenInput}
            onChange={(e) => {
              setAmountYenInput(e.target.value.replace(/[^0-9]/g, ''));
              setSaved(null);
            }}
            placeholder="金額"
            className="min-w-0 flex-1 rounded-xl px-3 py-2 text-sm"
            style={{
              background: 'var(--plane)',
              color: 'var(--ink)',
              border: '1px solid var(--hairline)',
            }}
          />
        </div>

        <input
          type="text"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setSaved(null);
          }}
          placeholder="店名"
          aria-label="店名"
          className="mt-3 w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />

        <input
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="メモ(任意)"
          aria-label="メモ"
          className="mt-3 w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />

        <select
          value={genreId}
          onChange={(e) => setGenreId(e.target.value)}
          className="mt-3 w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        >
          <option value="">未分類</option>
          {genreOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        {!isIncome ? (
          <label className="mt-3 block">
            <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              目標の扱い
              {occurredOn > todayJst()
                ? '(今日より先の日付は「予定」として、使った額には入りません)'
                : ''}
            </span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'normal' | 'special')}
              className="mt-1 w-full rounded-xl px-3 py-2 text-sm"
              style={{
                background: 'var(--plane)',
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
          disabled={saving || !canSave}
          className="mt-4 w-full rounded-full py-3 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {saving ? '登録中…' : '登録する'}
        </button>

        {saveError ? (
          <p className="mt-2 text-center text-xs" style={{ color: 'var(--over)' }}>
            {saveError}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
