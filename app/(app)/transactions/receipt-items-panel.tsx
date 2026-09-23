'use client';

import { useRef, useState } from 'react';

import { formatYen } from '@/domain/money';
import { receiptItemsStatus } from '@/domain/receipt-items';
import { DEFAULT_DETECTION_RULES } from '@/features/classification/rules';
import type { CategoryOption } from '@/features/classification/store';
import type { PaymentMethod } from '@/features/import/adapters';
import type { ReceiptParseResult } from '@/features/import/receipt-ai';
import { resizeToJpegBase64 } from '@/features/import/resize-image';
import type { ReceiptItem } from '@/features/receipts/items-store';
import { buildPreview } from '@/features/transactions/import-pipeline';
import { fetchLearnedRules } from '@/features/transactions/rules-client';
import { replaceReceiptItemsAction, setExpenseSubtypeAction } from './actions';

type EditRowState = {
  name: string;
  amountYen: string;
  categoryId: string;
  /** AIが付けた商品分類(ADR-036)。この手入力フォームでは編集させず、そのまま持ち回す。 */
  productType: string | null;
};

function toEditRows(items: readonly ReceiptItem[]): EditRowState[] {
  return items.map((it) => ({
    name: it.name,
    amountYen: String(Math.abs(it.amountYen)),
    categoryId: it.categoryId ?? '',
    productType: it.productType,
  }));
}

/**
 * レシートの品目表示 + 未登録ならその場で登録できるパネル(本人発案、ADR-038)。
 *
 * 元は明細一覧(/transactions)の行(split-editor.tsx、P10-40)専用だったが、
 * 「家計簿(/spending)からもレシートの詳細が見たいし、レシート登録も
 * 家計簿の方の責務だと感じる」という指摘を受け、明細行と家計簿のカテゴリ
 * 別内訳(spending/category-breakdown-chart.tsx)の両方から使う共通部品として
 * 切り出した(ADR-033:同じロジックを複数箇所に書かない)。呼び出し側が
 * 品目・小分類の状態を持ち、更新結果はコールバックで返す(制御コンポーネント)。
 *
 * 家計簿側は「レシートの画像までは要らない、品目の中身が見えればいい」という
 * 要望のため、ここでもレシート画像(receipt_image_path)は扱わない。
 *
 * ── 読み取った直後にその場で編集できる(本人発案、ADR-039)─────────
 * 「レシート読み込んだあと、すぐに編集できるようにして。再度写真撮るのは
 * 手間すぎる」への対応。元は品目の手入力修正(ADR-035)は「品目の合計が
 * 明細額と一致しない(mismatched)」ときだけ`split-editor.tsx`側に別途
 * 出す仕組みだったが、それだと (1) 合計は合っていても品目名や金額の
 * 読み間違いは直せない (2) `/spending`側にはそもそも編集手段が無い、
 * という2つの穴があった。品目がある限りいつでも「編集する」から直せる
 * ようにし、この共通パネルへ一本化した。レシート添付(`attachReceipt`)
 * 直後は追加の操作を挟まず、そのまま編集フォームを開く。
 */
export function ReceiptItemsPanel({
  transaction,
  categories,
  categoryCode,
  items,
  onItemsReplaced,
  subtype,
  onSubtypeReplaced,
}: {
  transaction: {
    id: string;
    occurredOn: string;
    accountId: string;
    paymentMethod: PaymentMethod;
    amountYen: number;
  };
  categories: readonly CategoryOption[];
  /** 生活費の小分類(ADR-036)を出してよいかの判定。表示名ではなく code で見る(ADR-016)。 */
  categoryCode: string | null;
  items: readonly ReceiptItem[];
  onItemsReplaced: (items: ReceiptItem[]) => void;
  subtype: string | null;
  onSubtypeReplaced: (subtype: string) => void;
}) {
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editRows, setEditRows] = useState<EditRowState[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const targetAbsYen = Math.abs(transaction.amountYen);
  const itemsStatus = receiptItemsStatus(items, transaction.amountYen);

  function openEdit(source: readonly ReceiptItem[]): void {
    setEditRows(toEditRows(source));
    setEditError(null);
    setEditOpen(true);
  }

  // 品目の記録が無い明細に、後からレシートを紐付ける(本人発案、P10-40)。
  async function attachReceipt(file: File): Promise<void> {
    setAttaching(true);
    setAttachError(null);
    try {
      const imageBase64 = await resizeToJpegBase64(file);
      const response = await fetch('/api/import/receipt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: imageBase64, mediaType: 'image/jpeg' }),
      });
      const parsed = (await response.json()) as ReceiptParseResult;
      const receipt = parsed.transactions[0];
      if (!receipt) {
        setAttachError(parsed.warnings[0] ?? 'レシートとして読み取れませんでした。');
        return;
      }
      if (receipt.items.length === 0 && receipt.expenseSubtype === null) {
        setAttachError('品目を読み取れませんでした。');
        return;
      }

      if (receipt.items.length > 0) {
        // 品目は既存の分類パイプライン(ルール)に通す。/transactions/receipt
        // と同じ考え方(ADR-035)だが、こちらは1件だけの追加操作のため
        // AIへの分類依頼(課金)まではせず、ルールだけで済ませる。読み違いが
        // あればこの直後に開く編集フォーム(下記)でその場に直せる。
        const { rules: learnedRules, categoryNameById } = await fetchLearnedRules();
        const classified = buildPreview(
          receipt.items.map((item) => ({
            occurredOn: transaction.occurredOn,
            description: item.description,
            amountYen: item.amountYen,
            paymentMethod: transaction.paymentMethod,
          })),
          transaction.accountId,
          (i) => `attach-${transaction.id}-${i}`,
          [...DEFAULT_DETECTION_RULES, ...learnedRules],
          categoryNameById,
          'manual',
        );
        const payload = classified.map((row, i) => ({
          name: row.description,
          amountYen: row.amountYen,
          categoryId: row.categoryId,
          productType: receipt.items[i]?.productType ?? null,
        }));
        const result = await replaceReceiptItemsAction(transaction.id, payload);
        if (result.error) {
          setAttachError(result.error);
          return;
        }
        const saved = payload.map((p, i) => ({
          id: `pending-${i}`,
          name: p.name,
          amountYen: p.amountYen,
          categoryId: p.categoryId,
          categoryName: categories.find((c) => c.id === p.categoryId)?.name ?? null,
          productType: p.productType,
        }));
        onItemsReplaced(saved);
        // 読み取り直後、追加の操作を挟まずそのまま編集フォームを開く
        // (「再度写真撮るのは手間すぎる」への対応。撮り直さなくても
        // その場で品目名・金額・カテゴリを直せる)。
        openEdit(saved);
      }

      if (receipt.expenseSubtype !== null) {
        const subtypeResult = await setExpenseSubtypeAction(transaction.id, receipt.expenseSubtype);
        if (!subtypeResult.error) onSubtypeReplaced(receipt.expenseSubtype);
      }
    } catch {
      setAttachError('レシートを読み取れませんでした。');
    } finally {
      setAttaching(false);
    }
  }

  function updateEditRow(index: number, patch: Partial<EditRowState>): void {
    setEditRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const editSign = transaction.amountYen < 0 ? -1 : 1;
  const editSumAbsYen = editRows.reduce((acc, r) => acc + Math.abs(Number(r.amountYen) || 0), 0);
  const canSaveEdit = editRows.every((r) => r.name.trim() !== '' && Number(r.amountYen) > 0);

  // 分割(`assertValidSplits`)と違い、合計が明細の金額と一致することは
  // 保存の条件にしない(一致しないまま保存してよい設計、本人発案、ADR-035)。
  async function saveEdit(): Promise<void> {
    setEditSaving(true);
    setEditError(null);
    const payload = editRows.map((r) => ({
      name: r.name.trim(),
      amountYen: editSign * Number(r.amountYen),
      categoryId: r.categoryId || null,
      // 商品分類(AIの自由記述、ADR-036)はこのフォームでは編集させないが、
      // 保存は全行の置き換えのため、渡さないと消えてしまう。そのまま持ち回す。
      productType: r.productType,
    }));
    const result = await replaceReceiptItemsAction(transaction.id, payload);
    if (result.error) {
      setEditError(result.error);
      setEditSaving(false);
      return;
    }
    onItemsReplaced(
      payload.map((p, i) => ({
        id: items[i]?.id ?? `pending-${i}`,
        name: p.name,
        amountYen: p.amountYen,
        categoryId: p.categoryId,
        categoryName: categories.find((c) => c.id === p.categoryId)?.name ?? null,
        productType: p.productType,
      })),
    );
    setEditSaving(false);
    setEditOpen(false);
  }

  return (
    <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--hairline)' }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>
          レシートの品目
        </p>
        {items.length > 0 ? (
          <button
            type="button"
            onClick={() => (editOpen ? setEditOpen(false) : openEdit(items))}
            className="text-[11px] font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            {editOpen ? 'やめる' : '編集する'}
          </button>
        ) : null}
      </div>

      {editOpen ? (
        <div className="mt-1.5 space-y-2">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            品目ごとに品名・金額・カテゴリを直せます。合計を一致させる必要はありません。
          </p>

          {editRows.map((row, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="text"
                value={row.name}
                onChange={(e) => updateEditRow(index, { name: e.target.value })}
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
                onChange={(e) => updateEditRow(index, { categoryId: e.target.value })}
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
                  updateEditRow(index, { amountYen: e.target.value.replace(/[^0-9]/g, '') })
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
              style={{ color: editSumAbsYen === targetAbsYen ? 'var(--ink-muted)' : 'var(--over)' }}
            >
              品目合計 {formatYen(editSumAbsYen, { sign: 'never' })}(明細額{' '}
              {formatYen(targetAbsYen, { sign: 'never' })})
            </span>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={editSaving || !canSaveEdit}
              className="flex-1 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {editSaving ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              disabled={editSaving}
              className="rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
            >
              やめる
            </button>
          </div>

          {editError ? (
            <p className="text-xs" style={{ color: 'var(--over)' }}>
              {editError}
            </p>
          ) : null}
        </div>
      ) : items.length > 0 ? (
        <>
          <ul className="mt-1.5 space-y-1">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-baseline justify-between gap-3 text-xs"
                style={{ color: 'var(--ink-secondary)' }}
              >
                <span className="min-w-0 truncate">
                  {item.name}
                  {/* 商品の種類(AIの自由記述、ADR-036)。固定カテゴリのバッジと
                      混ざらないよう括弧書きの添え字にする。 */}
                  {item.productType ? (
                    <span className="ml-1" style={{ color: 'var(--ink-muted)' }}>
                      ({item.productType})
                    </span>
                  ) : null}
                </span>
                <span className="tabular shrink-0">
                  {formatYen(item.amountYen, { sign: 'never' })}
                </span>
              </li>
            ))}
          </ul>
          {/* 品目の合計が明細額と一致しない(ADR-035)。編集は常にできるが、
              読み取りが不正確だった可能性を控えめに知らせる。 */}
          {itemsStatus === 'mismatched' ? (
            <p className="mt-1 text-[11px]" style={{ color: 'var(--over)' }}>
              品目の合計が金額と一致しません
            </p>
          ) : null}
        </>
      ) : (
        <div className="mt-1.5 space-y-1.5">
          <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            品目の記録はありません
          </p>
          <input
            ref={receiptInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void attachReceipt(file);
            }}
          />
          <button
            type="button"
            onClick={() => receiptInputRef.current?.click()}
            disabled={attaching}
            className="text-xs font-semibold disabled:opacity-40"
            style={{ color: 'var(--accent)' }}
          >
            {attaching ? '読み取っています…' : 'レシートを登録する'}
          </button>
          {attachError ? (
            <p className="text-[11px]" style={{ color: 'var(--over)' }}>
              {attachError}
            </p>
          ) : null}
        </div>
      )}

      {/* 生活費の小分類(本人発案、ADR-036)。「生活費」カテゴリのときだけ添える。 */}
      {!editOpen && subtype && categoryCode === 'living' ? (
        <p className="mt-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          生活費の内訳:{subtype}
        </p>
      ) : null}
    </div>
  );
}
