'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { formatYen } from '@/domain/money';
import { isRiskyPaymentMethod } from '@/features/classification/rules';
import type { CategoryOption } from '@/features/classification/store';
import type { PaymentMethod } from '@/features/import/adapters';
import type { TransactionSplit } from '@/features/transactions/splits-store';
import type { StoredTransaction } from '@/features/transactions/store';
import { replaceSplitsAction, updateTransactionDateAction } from './actions';

const METHOD_LABEL: Partial<Record<PaymentMethod, string>> = {
  revolving: 'リボ払い',
  cashing: 'キャッシング',
  installment: '分割払い',
};

type SplitRowState = { categoryId: string; amountYen: string; note: string };

/**
 * 明細1行 + 複数カテゴリ分割の編集(本人発案)。
 *
 * 表示は `components/ui/transaction-row.tsx` の見た目に合わせつつ、
 * 行そのものをボタンにして開閉する(payment-history.tsx の Card 開閉と
 * 同じパターン)。取り込みプレビュー画面(まだ DB に無い明細)では
 * 分割できないため、あちらは元の `TransactionRow` のまま変えていない。
 *
 * 金額の入力は「正の大きさ」で受け取り、保存時に元の明細の符号
 * (支出=負、収入=正、ADR-008)を掛けて揃える。分割を編集する本人に
 * マイナス記号を意識させないための配慮。
 */
export function TransactionRowWithSplit({
  transaction,
  categories,
  initialSplits,
}: {
  transaction: StoredTransaction;
  categories: readonly CategoryOption[];
  initialSplits: readonly TransactionSplit[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [splits, setSplits] = useState<readonly TransactionSplit[]>(initialSplits);
  const [rows, setRows] = useState<SplitRowState[]>(() => initialRows(initialSplits, categories));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [occurredOn, setOccurredOn] = useState(transaction.occurredOn);
  const [dateSaving, setDateSaving] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);

  const isIncome = transaction.amountYen > 0;
  const risky = isRiskyPaymentMethod(transaction.paymentMethod);
  const methodLabel = METHOD_LABEL[transaction.paymentMethod];
  const targetAbsYen = Math.abs(transaction.amountYen);
  const sumAbsYen = rows.reduce((acc, r) => acc + (Number(r.amountYen) || 0), 0);
  const canSave =
    rows.length >= 2 && rows.every((r) => Number(r.amountYen) > 0) && sumAbsYen === targetAbsYen;

  function addRow(): void {
    setRows((prev) => [...prev, { categoryId: categories[0]?.id ?? '', amountYen: '', note: '' }]);
  }
  function removeRow(index: number): void {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }
  function updateRow(index: number, patch: Partial<SplitRowState>): void {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    const sign = transaction.amountYen < 0 ? -1 : 1;
    const payload = rows.map((r) => ({
      categoryId: r.categoryId || null,
      amountYen: sign * Number(r.amountYen),
      note: r.note.trim() === '' ? null : r.note.trim(),
    }));

    const result = await replaceSplitsAction(transaction.id, payload);
    if (result.error) {
      setError(result.error);
      setSaving(false);
      return;
    }
    setSplits(
      payload.map((p, i) => ({
        id: `pending-${i}`,
        categoryId: p.categoryId,
        categoryName: categories.find((c) => c.id === p.categoryId)?.name ?? null,
        amountYen: p.amountYen,
        note: p.note,
      })),
    );
    setSaving(false);
    setOpen(false);
  }

  async function saveDate(): Promise<void> {
    setDateSaving(true);
    setDateError(null);
    const result = await updateTransactionDateAction(transaction.id, occurredOn);
    if (result.error) {
      setDateError(result.error);
      setDateSaving(false);
      return;
    }
    setDateSaving(false);
    // 日付が変わると一覧の日付グループ(page.tsx の groupByDate)自体が
    // 変わるため、クライアント側の state を書き換えるだけでは反映しきれない。
    // サーバーコンポーネントを取り直す。
    router.refresh();
  }

  async function clearSplits(): Promise<void> {
    setSaving(true);
    setError(null);
    const result = await replaceSplitsAction(transaction.id, []);
    if (result.error) {
      setError(result.error);
      setSaving(false);
      return;
    }
    setSplits([]);
    setRows(initialRows([], categories));
    setSaving(false);
    setOpen(false);
  }

  return (
    <li className="px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px]" style={{ color: 'var(--ink)' }}>
            {transaction.description}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              {splits.length > 0
                ? splits
                    .map((s) =>
                      s.note
                        ? `${s.note}(${s.categoryName ?? '未分類'})`
                        : (s.categoryName ?? '未分類'),
                    )
                    .join(' / ')
                : (transaction.categoryName ?? '未分類')}
            </span>

            {risky && methodLabel ? (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: 'var(--over-track)', color: 'var(--over)' }}
              >
                <span aria-hidden>!</span>
                {methodLabel}
              </span>
            ) : null}

            {transaction.reviewStatus === 'pending' ? (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
              >
                確認待ち
              </span>
            ) : null}

            {splits.length > 0 ? (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ background: 'var(--plane)', color: 'var(--ink-muted)' }}
              >
                分割済み
              </span>
            ) : null}
          </div>
        </div>

        <span
          className="tabular shrink-0 text-[15px] font-semibold"
          style={{ color: isIncome ? 'var(--income)' : 'var(--ink)' }}
        >
          {isIncome ? '+' : '−'}
          {formatYen(targetAbsYen)}
        </span>
      </button>

      {open ? (
        <div
          className="mt-3 space-y-3 rounded-2xl border p-3"
          style={{ borderColor: 'var(--hairline)' }}
        >
          {/* 日付の修正(本人発案)。レシート・CSV・メールいずれの取り込みでも
              日付を直す経路がこれまで無かった。分割の編集とは別の保存単位
              にしてある(片方が未入力・未完了でももう片方だけ保存できる)。 */}
          <div className="flex items-center gap-2">
            <label
              className="text-[11px] font-medium tracking-[0.08em] uppercase"
              style={{ color: 'var(--ink-muted)' }}
            >
              日付
            </label>
            <input
              type="date"
              value={occurredOn}
              onChange={(e) => setOccurredOn(e.target.value)}
              className="flex-1 rounded-xl px-3 py-2 text-sm"
              style={{
                background: 'var(--plane)',
                color: 'var(--ink)',
                border: '1px solid var(--hairline)',
              }}
            />
            <button
              type="button"
              onClick={() => void saveDate()}
              disabled={dateSaving || occurredOn === transaction.occurredOn}
              className="shrink-0 rounded-full px-4 py-2 text-xs font-semibold disabled:opacity-40"
              style={{ background: 'var(--plane)', color: 'var(--accent)' }}
            >
              {dateSaving ? '保存中…' : '日付を保存'}
            </button>
          </div>
          {dateError ? (
            <p className="text-xs" style={{ color: 'var(--over)' }}>
              {dateError}
            </p>
          ) : null}

          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            カテゴリごとに金額を分けます。合計は{formatYen(targetAbsYen, { sign: 'never' })}
            に一致させてください。
          </p>

          {rows.map((row, index) => (
            <div key={index} className="space-y-1">
              <div className="flex gap-2">
                <select
                  value={row.categoryId}
                  onChange={(e) => updateRow(index, { categoryId: e.target.value })}
                  className="flex-1 rounded-xl px-3 py-2 text-sm"
                  style={{
                    background: 'var(--plane)',
                    color: 'var(--ink)',
                    border: '1px solid var(--hairline)',
                  }}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  inputMode="numeric"
                  value={row.amountYen}
                  onChange={(e) =>
                    updateRow(index, { amountYen: e.target.value.replace(/[^0-9]/g, '') })
                  }
                  placeholder="金額"
                  className="w-24 rounded-xl px-3 py-2 text-sm"
                  style={{
                    background: 'var(--plane)',
                    color: 'var(--ink)',
                    border: '1px solid var(--hairline)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="shrink-0 px-2 text-xs"
                  style={{ color: 'var(--over)' }}
                >
                  削除
                </button>
              </div>
              {/* 何を指しているかのメモ(本人発案)。レシートの商品行を自動分割
                  したときは、ここに商品名が入って残る。 */}
              <input
                type="text"
                value={row.note}
                onChange={(e) => updateRow(index, { note: e.target.value })}
                placeholder="メモ(任意。何の分だったか)"
                className="w-full rounded-xl px-3 py-1.5 text-xs"
                style={{
                  background: 'var(--plane)',
                  color: 'var(--ink)',
                  border: '1px solid var(--hairline)',
                }}
              />
            </div>
          ))}

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={addRow}
              className="text-xs font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              + カテゴリを追加
            </button>
            <span
              className="tabular text-xs"
              style={{ color: sumAbsYen === targetAbsYen ? 'var(--ink-muted)' : 'var(--over)' }}
            >
              合計 {formatYen(sumAbsYen, { sign: 'never' })}
            </span>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !canSave}
              className="flex-1 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {saving ? '保存中…' : '保存'}
            </button>
            {splits.length > 0 ? (
              <button
                type="button"
                onClick={() => void clearSplits()}
                disabled={saving}
                className="rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
                style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
              >
                分割を解除
              </button>
            ) : null}
          </div>

          {error ? (
            <p className="text-xs" style={{ color: 'var(--over)' }}>
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function initialRows(
  splits: readonly TransactionSplit[],
  categories: readonly CategoryOption[],
): SplitRowState[] {
  if (splits.length > 0) {
    return splits.map((s) => ({
      categoryId: s.categoryId ?? '',
      amountYen: String(Math.abs(s.amountYen)),
      note: s.note ?? '',
    }));
  }
  const first = categories[0]?.id ?? '';
  const second = categories[1]?.id ?? first;
  return [
    { categoryId: first, amountYen: '', note: '' },
    { categoryId: second, amountYen: '', note: '' },
  ];
}
