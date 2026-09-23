'use client';

import { useRef, useState } from 'react';

import { formatYen } from '@/domain/money';
import { DEFAULT_DETECTION_RULES } from '@/features/classification/rules';
import type { CategoryOption } from '@/features/classification/store';
import type { PaymentMethod } from '@/features/import/adapters';
import type { ReceiptParseResult } from '@/features/import/receipt-ai';
import { resizeToJpegBase64 } from '@/features/import/resize-image';
import type { ReceiptItem } from '@/features/receipts/items-store';
import { buildPreview } from '@/features/transactions/import-pipeline';
import { fetchLearnedRules } from '@/features/transactions/rules-client';
import { replaceReceiptItemsAction, setExpenseSubtypeAction } from './actions';

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

  // 品目の記録が無い明細に、後からレシートを紐付ける(本人発案、P10-40)。
  // このパネルは items.length === 0 のときしか登録ボタンを出さないため、
  // 保存後の一覧は常に新規(pending-N)扱いでよい(既存行の id を引き継ぐ
  // 必要が無い)。
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
        // AIへの分類依頼(課金)まではせず、ルールだけで済ませる。
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
        onItemsReplaced(
          payload.map((p, i) => ({
            id: `pending-${i}`,
            name: p.name,
            amountYen: p.amountYen,
            categoryId: p.categoryId,
            categoryName: categories.find((c) => c.id === p.categoryId)?.name ?? null,
            productType: p.productType,
          })),
        );
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

  return (
    <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--hairline)' }}>
      <p className="text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>
        レシートの品目
      </p>
      {items.length > 0 ? (
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
      {subtype && categoryCode === 'living' ? (
        <p className="mt-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          生活費の内訳:{subtype}
        </p>
      ) : null}
    </div>
  );
}
