'use client';

import { useState } from 'react';

import { formatYen } from '@/domain/money';
import { receiptItemsStatus } from '@/domain/receipt-items';
import { isRiskyPaymentMethod } from '@/features/classification/rules';
import type { CategoryOption } from '@/features/classification/store';
import type { PaymentMethod } from '@/features/import/adapters';
import type { ReceiptItem } from '@/features/receipts/items-store';
import type { TransactionSplit } from '@/features/transactions/splits-store';
import type { StoredTransaction } from '@/features/transactions/store';
import { replaceReceiptItemsAction, replaceSplitsAction, updateTransactionAction } from './actions';

const METHOD_LABEL: Partial<Record<PaymentMethod, string>> = {
  revolving: 'リボ払い',
  cashing: 'キャッシング',
  installment: '分割払い',
};

type SplitRowState = { categoryId: string; amountYen: string; note: string };
type ItemRowState = { name: string; amountYen: string; categoryId: string };

/**
 * 明細1行 + カテゴリの編集(単一カテゴリの変更・複数カテゴリへの分割)。
 *
 * 表示は `components/ui/transaction-row.tsx` の見た目に合わせつつ、
 * 行そのものをボタンにして開閉する(payment-history.tsx の Card 開閉と
 * 同じパターン)。取り込みプレビュー画面(まだ DB に無い明細)では
 * 分割できないため、あちらは元の `TransactionRow` のまま変えていない。
 *
 * ── なぜ単純なカテゴリ変更(mode='simple')が要るか(本人からの不具合報告
 *    「明細の編集で保存ボタンが押下できない」)────────────────────
 * P8-2 で複数カテゴリ分割を追加したとき、この行を開いたときの編集UIを
 * まるごと分割フォームに差し替えてしまっていた。分割フォームの保存条件
 * (`canSave`)は「2行以上・全行が0より大きい額・合計が明細額と一致」を
 * 要求するため、「1つのカテゴリに直したいだけ」の本来最も多いはずの
 * 操作では条件を満たしようが無く、保存ボタンが常に押せなかった
 * (分割前は `TransactionRow` 自体が編集不可だったため、この単純な
 * 編集経路は実は一度も存在したことが無かった)。単純な変更は
 * `updateTransactionAction()`(既存、確認待ちキューが使っているのと
 * 同じ経路)に戻し、分割は「カテゴリを分ける」から明示的に開く
 * 別モードにした。
 *
 * 金額の入力は「正の大きさ」で受け取り、保存時に元の明細の符号
 * (支出=負、収入=正、ADR-008)を掛けて揃える。分割を編集する本人に
 * マイナス記号を意識させないための配慮。
 *
 * ── 品目の金額修正(ADR-035) ────────────────────────────
 * レシート取り込み時に品目の合計が明細額と一致しなかった(mismatched)
 * 場合だけ、その場で品目の金額・カテゴリを直せる。分割(mode/open)とは
 * 独立した別の開閉状態(itemsOpen)で、合計を一致させることは保存の
 * 条件にしない(receipt_items は分割と違い合計一致を求めない設計、
 * domain/receipt-items.ts 参照)。
 */
export function TransactionRowWithSplit({
  transaction,
  categories,
  initialSplits,
  receiptItems = [],
}: {
  transaction: StoredTransaction;
  categories: readonly CategoryOption[];
  initialSplits: readonly TransactionSplit[];
  /** レシートの商品行(ADR-034)。カテゴリ分割の有無に関わらず、常に見せる。 */
  receiptItems?: readonly ReceiptItem[];
}) {
  const [open, setOpen] = useState(false);
  // 既に分割済みの明細は分割フォームから開く。それ以外(大半の明細)は
  // 単一カテゴリの変更から開く——分割はあくまで例外的な操作。
  const [mode, setMode] = useState<'simple' | 'split'>(
    initialSplits.length > 0 ? 'split' : 'simple',
  );
  const [categoryId, setCategoryId] = useState(transaction.categoryId ?? '');
  const [splits, setSplits] = useState<readonly TransactionSplit[]>(initialSplits);
  const [rows, setRows] = useState<SplitRowState[]>(() => initialRows(initialSplits, categories));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // レシートの品目(ADR-034/035)。合計が明細額と一致しない(mismatched)
  // ときだけ、その場で金額・カテゴリを直せるようにする。
  const [items, setItems] = useState<readonly ReceiptItem[]>(receiptItems);
  const [itemsOpen, setItemsOpen] = useState(false);
  const [itemRows, setItemRows] = useState<ItemRowState[]>(() => initialItemRows(items));
  const [itemsSaving, setItemsSaving] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const itemsStatus = receiptItemsStatus(items, transaction.amountYen);

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

  const categoryUnchanged = categoryId === (transaction.categoryId ?? '');

  async function saveCategory(): Promise<void> {
    if (!categoryId || categoryUnchanged) return;
    setSaving(true);
    setError(null);
    const result = await updateTransactionAction(transaction.id, categoryId);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
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
    // 分割を解除した直後は「じゃあ1つのカテゴリで」が次にやりたいことの
    // はずなので、閉じずに単純なカテゴリ変更フォームへ戻す。
    setMode('simple');
  }

  function updateItemRow(index: number, patch: Partial<ItemRowState>): void {
    setItemRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const itemsSign = transaction.amountYen < 0 ? -1 : 1;
  const itemsSumAbsYen = itemRows.reduce((acc, r) => acc + Math.abs(Number(r.amountYen) || 0), 0);
  const canSaveItems = itemRows.every((r) => r.name.trim() !== '' && Number(r.amountYen) > 0);

  // 分割(`assertValidSplits`)と違い、合計が明細の金額と一致することは
  // 保存の条件にしない(一致しないまま保存してよい設計、本人発案)。
  async function saveItems(): Promise<void> {
    setItemsSaving(true);
    setItemsError(null);
    const payload = itemRows.map((r) => ({
      name: r.name.trim(),
      amountYen: itemsSign * Number(r.amountYen),
      categoryId: r.categoryId || null,
    }));
    const result = await replaceReceiptItemsAction(transaction.id, payload);
    if (result.error) {
      setItemsError(result.error);
      setItemsSaving(false);
      return;
    }
    setItems(
      payload.map((p, i) => ({
        id: items[i]?.id ?? `pending-${i}`,
        name: p.name,
        amountYen: p.amountYen,
        categoryId: p.categoryId,
        categoryName: categories.find((c) => c.id === p.categoryId)?.name ?? null,
      })),
    );
    setItemsSaving(false);
    setItemsOpen(false);
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

          {/* レシートの商品行(ADR-034)。分割済みの明細はカテゴリの内訳に
              品名が出ているため(上の splits.map)、二重には出さない。 */}
          {splits.length === 0 && items.length > 0 ? (
            <p className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {items.map((it) => it.name).join('、')}
            </p>
          ) : null}
        </div>

        <span
          className="tabular shrink-0 text-[15px] font-semibold"
          style={{ color: isIncome ? 'var(--income)' : 'var(--ink)' }}
        >
          {isIncome ? '+' : '−'}
          {formatYen(targetAbsYen)}
        </span>
      </button>

      {/* 品目のタップ導線(本人からの不具合報告「レシートの品目もどこから
          飛べばいいかわかりません...タップしても何も見れない」)。行を開くと
          単価付きの内訳が見える(以前はプレビューのテキストだけで、開いても
          カテゴリ編集フォームしか出ず品目自体は確認できなかった)。 */}
      {open && items.length > 0 ? (
        <div className="mt-3 rounded-2xl border p-3" style={{ borderColor: 'var(--hairline)' }}>
          <p className="text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>
            レシートの品目
          </p>
          <ul className="mt-1.5 space-y-1">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-baseline justify-between gap-3 text-xs"
                style={{ color: 'var(--ink-secondary)' }}
              >
                <span className="min-w-0 truncate">{item.name}</span>
                <span className="tabular shrink-0">
                  {formatYen(item.amountYen, { sign: 'never' })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 品目の合計が明細額と一致しない(ADR-035)。カテゴリの開閉(open)とは
          独立して、その場で金額・カテゴリを直せるようにする。合わせること
          自体は必須にしない——保存条件は名前が空でない・金額が0でないだけ
          (assertEditableReceiptItems 参照)。 */}
      {splits.length === 0 && itemsStatus === 'mismatched' ? (
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[11px]" style={{ color: 'var(--over)' }}>
            品目の合計が金額と一致しません
          </span>
          <button
            type="button"
            onClick={() => {
              if (!itemsOpen) setItemRows(initialItemRows(items));
              setItemsOpen((v) => !v);
            }}
            className="text-[11px] font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            {itemsOpen ? '閉じる' : '金額を直す'}
          </button>
        </div>
      ) : null}

      {itemsOpen ? (
        <div
          className="mt-3 space-y-2 rounded-2xl border p-3"
          style={{ borderColor: 'var(--hairline)' }}
        >
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            品目ごとに金額・カテゴリを直せます。合計を一致させる必要はありません。
          </p>

          {itemRows.map((row, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="text"
                value={row.name}
                onChange={(e) => updateItemRow(index, { name: e.target.value })}
                placeholder="品名"
                className="flex-1 rounded-xl px-3 py-2 text-sm"
                style={{
                  background: 'var(--plane)',
                  color: 'var(--ink)',
                  border: '1px solid var(--hairline)',
                }}
              />
              <select
                value={row.categoryId}
                onChange={(e) => updateItemRow(index, { categoryId: e.target.value })}
                className="rounded-xl px-2 py-2 text-sm"
                style={{
                  background: 'var(--plane)',
                  color: 'var(--ink)',
                  border: '1px solid var(--hairline)',
                }}
              >
                <option value="">未分類</option>
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
                  updateItemRow(index, { amountYen: e.target.value.replace(/[^0-9]/g, '') })
                }
                placeholder="金額"
                className="w-20 rounded-xl px-3 py-2 text-sm"
                style={{
                  background: 'var(--plane)',
                  color: 'var(--ink)',
                  border: '1px solid var(--hairline)',
                }}
              />
            </div>
          ))}

          <div className="flex items-center justify-between">
            <span
              className="tabular text-xs"
              style={{
                color: itemsSumAbsYen === targetAbsYen ? 'var(--ink-muted)' : 'var(--over)',
              }}
            >
              品目合計 {formatYen(itemsSumAbsYen, { sign: 'never' })}(明細額{' '}
              {formatYen(targetAbsYen, { sign: 'never' })})
            </span>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => void saveItems()}
              disabled={itemsSaving || !canSaveItems}
              className="flex-1 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {itemsSaving ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              onClick={() => setItemsOpen(false)}
              disabled={itemsSaving}
              className="rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
            >
              やめる
            </button>
          </div>

          {itemsError ? (
            <p className="text-xs" style={{ color: 'var(--over)' }}>
              {itemsError}
            </p>
          ) : null}
        </div>
      ) : null}

      {open && mode === 'simple' ? (
        <div
          className="mt-3 space-y-2 rounded-2xl border p-3"
          style={{ borderColor: 'var(--hairline)' }}
        >
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-sm"
            style={{
              background: 'var(--plane)',
              color: 'var(--ink)',
              border: '1px solid var(--hairline)',
            }}
          >
            <option value="" disabled>
              カテゴリを選ぶ
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => void saveCategory()}
              disabled={saving || !categoryId || categoryUnchanged}
              className="flex-1 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              onClick={() => setMode('split')}
              className="rounded-full px-4 py-2 text-sm font-semibold"
              style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
            >
              カテゴリを分ける
            </button>
          </div>

          {error ? (
            <p className="text-xs" style={{ color: 'var(--over)' }}>
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {open && mode === 'split' ? (
        <div
          className="mt-3 space-y-2 rounded-2xl border p-3"
          style={{ borderColor: 'var(--hairline)' }}
        >
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
            ) : (
              // まだ保存していない分割(splits が空)なら、DB には何も
              // 触れていないので単純にモードを戻すだけでよい。
              <button
                type="button"
                onClick={() => setMode('simple')}
                disabled={saving}
                className="rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
                style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
              >
                やめる
              </button>
            )}
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

function initialItemRows(items: readonly ReceiptItem[]): ItemRowState[] {
  return items.map((it) => ({
    name: it.name,
    amountYen: String(Math.abs(it.amountYen)),
    categoryId: it.categoryId ?? '',
  }));
}
