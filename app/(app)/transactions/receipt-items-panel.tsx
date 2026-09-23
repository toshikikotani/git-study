'use client';

import { useEffect, useRef, useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
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
 * レシートの品目表示 + 編集ダイアログ(本人発案、ADR-045)。
 *
 * 元は明細一覧(/transactions)の行(split-editor.tsx、P10-40)専用だったが、
 * 「家計簿(/spending)からもレシートの詳細が見たいし、レシート登録も
 * 家計簿の方の責務だと感じる」という指摘を受け、明細行と家計簿のカテゴリ
 * 別内訳(spending/category-breakdown-chart.tsx)の両方から使う共通部品として
 * 切り出した(ADR-040、ADR-033:同じロジックを複数箇所に書かない)。呼び出し側が
 * 品目・小分類の状態を持ち、更新結果はコールバックで返す(制御コンポーネント)。
 *
 * 家計簿側は「レシートの画像までは要らない、品目の中身が見えればいい」という
 * 要望のため、ここでもレシート画像(receipt_image_path)は扱わない。
 *
 * ── 編集はダイアログに一本化し、レシートの再読み込みもその中に置く
 *    (本人発案、ADR-045)─────────────────────────────────────
 * 「編集が微妙。既に登録したやつも編集すぐできるようにしたい。編集押したら
 * 編集ダイアログ出る。さらに再度レシート読み込みボタンを編集エディタに
 * 設ける」への対応。以前(ADR-041)は行内にインラインで開く編集フォームで、
 * レシートの再読み込みは「品目が無いとき」専用の別ボタンだった。
 * `BottomSheet`(split-editor.tsx の長押しプレビュー・more-menu.tsx が既に
 * 使っている共通のシート、ADR-042)を使ったダイアログへ統合し、品目の
 * 有無に関わらず同じ「編集する」入口から開き、ダイアログの中に「読み込む/
 * 読み込み直す」ボタンを常設した。読み込み直しは(再分類はするが)即座には
 * 保存せず、編集中の行を置き換えるだけ——本人がその場で見直し、必要なら
 * 直してから「保存」を押す1つの流れにまとめた(以前のように読み込み直後に
 * 自動保存してから編集を開く、という二度書きをしない)。
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
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRows, setEditRows] = useState<EditRowState[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const targetAbsYen = Math.abs(transaction.amountYen);
  const itemsStatus = receiptItemsStatus(items, transaction.amountYen);

  function openDialog(): void {
    setEditRows(toEditRows(items));
    setEditError(null);
    setRescanError(null);
    setDialogOpen(true);
  }

  function closeDialog(): void {
    setDialogOpen(false);
  }

  // Escape でも閉じる(more-menu.tsx・split-editor.tsx の BottomSheet と同じ流儀)。
  useEffect(() => {
    if (!dialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDialog();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen]);

  // レシートを(再)読み込む。品目が既にあってもいつでも呼べる——読み取った
  // 内容は保存せず、編集中の行(editRows)を置き換えるだけ。本人がその場で
  // 見直し、「保存」を押すまでDBには反映しない(P10-40の「品目が無ければ
  // 登録する」とADR-041の再読み込みを、このダイアログひとつに統合した)。
  async function rescanReceipt(file: File): Promise<void> {
    setRescanning(true);
    setRescanError(null);
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
        setRescanError(parsed.warnings[0] ?? 'レシートとして読み取れませんでした。');
        return;
      }
      if (receipt.items.length === 0 && receipt.expenseSubtype === null) {
        setRescanError('品目を読み取れませんでした。');
        return;
      }

      if (receipt.items.length > 0) {
        // 品目は既存の分類パイプライン(ルール)に通す。/transactions/receipt
        // と同じ考え方(ADR-035)だが、こちらは1件だけの追加操作のため
        // AIへの分類依頼(課金)まではせず、ルールだけで済ませる。読み違いが
        // あればこの直後の編集行でその場に直せる。
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
        setEditRows(
          classified.map((row, i) => ({
            name: row.description,
            amountYen: String(row.amountYen),
            categoryId: row.categoryId ?? '',
            productType: receipt.items[i]?.productType ?? null,
          })),
        );
      }

      // 生活費の小分類(ADR-036)は品目の編集行とは別の値のため、読み取れた
      // 時点でそのまま保存する(こちらに「保存」ボタンでの確定操作は無い)。
      if (receipt.expenseSubtype !== null) {
        const subtypeResult = await setExpenseSubtypeAction(transaction.id, receipt.expenseSubtype);
        if (!subtypeResult.error) onSubtypeReplaced(receipt.expenseSubtype);
      }
    } catch {
      setRescanError('レシートを読み取れませんでした。');
    } finally {
      setRescanning(false);
    }
  }

  function updateEditRow(index: number, patch: Partial<EditRowState>): void {
    setEditRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const editSign = transaction.amountYen < 0 ? -1 : 1;
  const editSumAbsYen = editRows.reduce((acc, r) => acc + Math.abs(Number(r.amountYen) || 0), 0);
  const canSaveEdit =
    editRows.length > 0 && editRows.every((r) => r.name.trim() !== '' && Number(r.amountYen) > 0);

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
    setDialogOpen(false);
  }

  return (
    <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--hairline)' }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>
          レシートの品目
        </p>
        <button
          type="button"
          onClick={openDialog}
          className="text-[11px] font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          {items.length > 0 ? '編集する' : 'レシートを登録する'}
        </button>
      </div>

      {items.length > 0 ? (
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
        <p className="mt-1.5 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          品目の記録はありません
        </p>
      )}

      {/* 生活費の小分類(本人発案、ADR-036)。「生活費」カテゴリのときだけ添える。 */}
      {subtype && categoryCode === 'living' ? (
        <p className="mt-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          生活費の内訳:{subtype}
        </p>
      ) : null}

      <BottomSheet open={dialogOpen} onClose={closeDialog} role="dialog">
        <div className="flex items-center justify-between px-3 pt-1 pb-2">
          <h2 className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
            品目を編集
          </h2>
          <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            外側をタップで閉じる
          </span>
        </div>

        <div className="space-y-2 px-3 pb-3">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            品目ごとに品名・金額・カテゴリを直せます。合計を一致させる必要はありません。
          </p>

          {/* レシートの(再)読み込み(本人発案、ADR-045)。品目の有無に関わらず
              いつでも使え、読み取った内容は下の編集行を置き換えるだけで
              即保存はしない——見直してから「保存」を押す1つの流れにする。 */}
          <input
            ref={receiptInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void rescanReceipt(file);
            }}
          />
          <button
            type="button"
            onClick={() => receiptInputRef.current?.click()}
            disabled={rescanning}
            className="w-full rounded-xl py-2 text-sm font-semibold disabled:opacity-40"
            style={{
              background: 'var(--plane)',
              color: 'var(--accent)',
              border: '1px solid var(--hairline)',
            }}
          >
            {rescanning
              ? '読み取っています…'
              : editRows.length > 0
                ? 'レシートを読み込み直す'
                : 'レシートを読み込む'}
          </button>
          {rescanError ? (
            <p className="text-[11px]" style={{ color: 'var(--over)' }}>
              {rescanError}
            </p>
          ) : null}

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

          {editRows.length > 0 ? (
            <div className="flex items-center justify-between">
              <span
                className="tabular text-xs"
                style={{
                  color: editSumAbsYen === targetAbsYen ? 'var(--ink-muted)' : 'var(--over)',
                }}
              >
                品目合計 {formatYen(editSumAbsYen, { sign: 'never' })}(明細額{' '}
                {formatYen(targetAbsYen, { sign: 'never' })})
              </span>
            </div>
          ) : null}

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
              onClick={closeDialog}
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
      </BottomSheet>
    </div>
  );
}
