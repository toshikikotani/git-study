'use client';

import { useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { SwipeableRow } from '@/components/ui/swipeable-row';
import { formatYen } from '@/domain/money';
import { receiptItemsStatus } from '@/domain/receipt-items';
import { GenreBadge } from '@/components/ui/genre-badge';
import { LedgerAmount } from '@/components/ui/money';
import { useGenreOverrides } from '@/components/ui/genre-style-context';
import { genreBarColor } from '@/domain/genre-style';
import { predictGenres, type GenreHistoryEntry } from '@/domain/genre-prediction';
import { MdReceiptLong } from 'react-icons/md';
import { ReceiptImageViewer } from '@/components/receipt/receipt-image-viewer';
import { isRiskyPaymentMethod } from '@/features/classification/rules';
import type { GenreShare } from '@/features/spending/views';
import type { GenreOption } from '@/features/genre/store';
import type { PaymentMethod } from '@/features/import/adapters';
import type { ReceiptItem } from '@/features/receipts/items-store';
import type { TransactionSplit } from '@/features/transactions/splits-store';
import type { StoredTransaction } from '@/features/transactions/store';
import { hapticFor } from '@/lib/haptics';
import { pushUndo } from '@/lib/undo';
import { resizeToJpegBase64 } from '@/features/import/resize-image';
import {
  deleteTransactionAction,
  duplicateTransactionAction,
  recordGenreCorrectionAction,
  replaceReceiptItemsAction,
  replaceSplitsAction,
  restoreDeletedTransactionAction,
  restoreRowFieldsAction,
  setTransactionKindAction,
  updateTransactionAction,
  updateTransactionMemoAction,
} from './actions';
import { ReceiptItemsPanel } from './receipt-items-panel';

const METHOD_LABEL: Partial<Record<PaymentMethod, string>> = {
  revolving: 'リボ払い',
  cashing: 'キャッシング',
  installment: '分割払い',
};

type SplitRowState = { genreId: string; amountYen: string; note: string };

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
 * `updateTransactionAction()`(既存)に戻し、分割は「カテゴリを分ける」
 * から明示的に開く別モードにした。
 *
 * 金額の入力は「正の大きさ」で受け取り、保存時に元の明細の符号
 * (支出=負、収入=正、ADR-008)を掛けて揃える。分割を編集する本人に
 * マイナス記号を意識させないための配慮。
 *
 * ── 開いてもカテゴリ編集フォームを自動で出さない(本人からのUX指摘
 *    「明細を開くとカテゴリ分けのやつが出てくる。これもいらん」)────
 * P10-31 で品目一覧を「行を開くと見える」形にしたが、この行は元々
 * 「開く=カテゴリ編集フォームを出す」ボタンだったため、開くだけで
 * 常にカテゴリ編集フォームまで一緒に出てしまっていた。P10-36では
 * これを品目がある明細だけに絞って直したが、本人から実機の画面(品目の
 * 無い明細でもフォームが開いたまま並んでいるスクリーンショット)で
 * 「これも編集でしか不要」と指摘があり、品目の有無に関わらず全ての
 * 明細に広げた。行を開くと現在の分類(見出しの文字列)と品目(あれば)
 * だけを見せ、「カテゴリを変更する」を押すまでカテゴリ編集フォーム
 * (mode='simple'/'split')を出さない。
 *
 * ── 品目の金額修正(ADR-035、ADR-041で編集そのものはパネル側へ移動) ──
 * 品目の編集フォーム自体は`receipt-items-panel.tsx`が持つ(いつでも
 * 「編集する」から直せる、ADR-041)。ここに残るのは「品目の合計が明細額と
 * 一致しない(mismatched)」ときに、行を閉じたままでも気づけるようにする
 * 控えめな警告(下のバナー)だけ——押すと行を開く(setOpen(true))だけで、
 * 実際の編集はそこで開くパネルに任せる。
 *
 * ── 左フリック/長押し(本人発案、ADR-042) ────────────────────
 * 「操作を重複させることが大事」という発案のもと、行ヘッダを
 * `SwipeableRow` で包み、左フリックはカテゴリ変更に直行
 * (open+categoryFormOpen を同時に立てる)、長押しは編集不可のその場
 * プレビュー(previewOpen、BottomSheet)を開く——タップ(行の開閉)は
 * 従来通りヘッダの `<button onClick>` がそのまま処理する。ADR-040/041で
 * 品目まわりの開閉は`ReceiptItemsPanel`へ既に整理済みのため、このADRの
 * スコープはジェスチャーの追加のみ。
 *
 * ── 金額・日付の編集(本人発案「今金額と日付が一切編集できない」、
 *    ADR-048) ───────────────────────────────────────
 * 単純なカテゴリ変更フォーム(mode='simple')に日付(`<input type="date">`)・
 * 金額(正の大きさのみ、カテゴリと同じくマイナス記号は意識させない)を
 * 追加し、「カテゴリを変更する」ボタンを「金額・日付・カテゴリを編集する」
 * に改めた。`updateTransactionAction()` 自体は変えず、任意の第4引数
 * (`patch`)として渡す——家計簿カレンダーは元のカテゴリのみの3引数呼び出し
 * のまま影響を受けない。
 */
/** 編集に必要な明細の項目(取り込み後の StoredTransaction も、家計簿の LedgerTransaction も満たす)。 */
export type EditableTransaction = Pick<
  StoredTransaction,
  | 'id'
  | 'accountId'
  | 'occurredOn'
  | 'description'
  | 'amountYen'
  | 'paymentMethod'
  | 'genreId'
  | 'genreName'
  | 'memo'
>;

/** 明細リストの行の見た目(店名・支店名・サムネイル・分割の比率など)。 */
export type RowDisplay = {
  /** 1行目:正規化した店名。 */
  name: string;
  /** 2行目の先頭:支店名。 */
  branch: string | null;
  thumbnailUrl: string | null;
  /** 分割した明細のジャンル比率(細い積み上げバー)。 */
  shares: readonly GenreShare[];
  scheduled: boolean;
  special: boolean;
};

export function TransactionRowWithSplit({
  transaction,
  categories,
  initialSplits,
  receiptItems = [],
  expenseSubtype = null,
  display,
  genreHistory = [],
  justSaved = false,
}: {
  transaction: EditableTransaction;
  /** レシート保存の直後に追加された行(挿入の動きを付ける)。 */
  justSaved?: boolean;
  display?: RowDisplay;
  /** 未分類の予測に使う、過去の「店 → ジャンル」。 */
  genreHistory?: readonly GenreHistoryEntry[];
  categories: readonly GenreOption[];
  initialSplits: readonly TransactionSplit[];
  /** レシートの商品行(ADR-034)。ジャンル分割の有無に関わらず、常に見せる。 */
  receiptItems?: readonly ReceiptItem[];
  /** 生活費の小分類(AIの自由記述、ADR-036)。 */
  expenseSubtype?: string | null;
}) {
  const overrides = useGenreOverrides();
  const [open, setOpen] = useState(false);
  // 既に分割済みの明細は分割フォームから開く。それ以外(大半の明細)は
  // 単一カテゴリの変更から開く——分割はあくまで例外的な操作。
  const [mode, setMode] = useState<'simple' | 'split'>(
    initialSplits.length > 0 ? 'split' : 'simple',
  );
  // カテゴリ編集フォームを開くかどうかは、行を開く(open)とは別の
  // 明示的な操作にする(上のコメント参照)。
  const [categoryFormOpen, setCategoryFormOpen] = useState(false);
  const [genreId, setGenreId] = useState(transaction.genreId ?? '');
  // 金額・日付の編集(本人発案「今金額と日付が一切編集できない」)。
  // カテゴリ変更と同じフォームにまとめる(下の canSaveSimpleEdit 参照)。
  const [amountAbsYenInput, setAmountAbsYenInput] = useState(
    String(Math.abs(transaction.amountYen)),
  );
  const [occurredOnInput, setOccurredOnInput] = useState(transaction.occurredOn);
  // 明細への自由記述メモ(本人発案、issue #95)。カテゴリ・金額・日付とは
  // 独立した操作のため、別の開閉状態・別のServer Actionにした。
  const [memo, setMemo] = useState(transaction.memo);
  const [memoFormOpen, setMemoFormOpen] = useState(false);
  const [memoInput, setMemoInput] = useState(transaction.memo ?? '');
  const [memoSaving, setMemoSaving] = useState(false);
  const [memoError, setMemoError] = useState<string | null>(null);
  const [splits, setSplits] = useState<readonly TransactionSplit[]>(initialSplits);
  const [rows, setRows] = useState<SplitRowState[]>(() => initialRows(initialSplits, categories));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // レシートの品目(ADR-034/035)。編集フォーム自体は receipt-items-panel.tsx
  // が持つ(ADR-041)。ここでは行を閉じたままでも見える要約・警告のために
  // 状態だけ持つ。
  const [items, setItems] = useState<readonly ReceiptItem[]>(receiptItems);
  const itemsStatus = receiptItemsStatus(items, transaction.amountYen);
  // 「カテゴリを変更する」を押すまでフォームを隠す(品目の有無に関わらず)。
  const showCategoryForm = categoryFormOpen;
  const [subtype, setSubtype] = useState(expenseSubtype);
  // 長押しのその場プレビュー(ADR-042)。open/categoryFormOpen とは独立
  // ——編集ではなく閲覧専用のため。
  const [previewOpen, setPreviewOpen] = useState(false);
  // 右スワイプのジャンル変更シート、左スワイプの削除・複製(家計簿の明細リスト)。
  const [genreSheetOpen, setGenreSheetOpen] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [special, setSpecial] = useState(display?.special ?? false);
  // 未分類のインライン分類(予測上位3件のシート)と、確定時のアニメーション。
  const [pickOpen, setPickOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  // 長押しのメニュー(ジャンル変更・分割・複製・削除、レシート付きは画像を見る・もう一度読み取る)。
  const [menuOpen, setMenuOpen] = useState(false);
  // 行を展開せず、明細から品目編集を開く。増やすたびにダイアログが開く。
  const [itemEditRequest, setItemEditRequest] = useState(0);

  const isIncome = transaction.amountYen > 0;
  const risky = isRiskyPaymentMethod(transaction.paymentMethod);
  const methodLabel = METHOD_LABEL[transaction.paymentMethod];
  const targetAbsYen = Math.abs(transaction.amountYen);
  const sumAbsYen = rows.reduce((acc, r) => acc + (Number(r.amountYen) || 0), 0);
  const canSave =
    rows.length >= 2 && rows.every((r) => Number(r.amountYen) > 0) && sumAbsYen === targetAbsYen;

  function addRow(): void {
    setRows((prev) => [...prev, { genreId: categories[0]?.id ?? '', amountYen: '', note: '' }]);
  }
  function removeRow(index: number): void {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }
  function updateRow(index: number, patch: Partial<SplitRowState>): void {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const amountAbsYen = Number(amountAbsYenInput);
  const simpleEditUnchanged =
    genreId === (transaction.genreId ?? '') &&
    amountAbsYen === targetAbsYen &&
    occurredOnInput === transaction.occurredOn;
  const canSaveSimpleEdit =
    !!genreId && amountAbsYen > 0 && occurredOnInput !== '' && !simpleEditUnchanged;

  async function saveSimpleEdit(): Promise<void> {
    if (!canSaveSimpleEdit) return;
    setSaving(true);
    setError(null);
    const result = await updateTransactionAction(transaction.id, genreId, {
      amountAbsYen,
      occurredOn: occurredOnInput,
      isIncome,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    const prevGenreId = transaction.genreId ?? '';
    const prevAmount = String(targetAbsYen);
    const prevDate = transaction.occurredOn;
    if (result.previous) {
      const previous = result.previous;
      pushUndo('変更しました', async () => {
        const r = await restoreRowFieldsAction(previous);
        if (r.error) return r.error;
        setGenreId(prevGenreId);
        setAmountAbsYenInput(prevAmount);
        setOccurredOnInput(prevDate);
        return null;
      });
    }
    setOpen(false);
    setCategoryFormOpen(false);
  }

  async function saveMemo(): Promise<void> {
    setMemoSaving(true);
    setMemoError(null);
    const result = await updateTransactionMemoAction(transaction.id, memoInput);
    setMemoSaving(false);
    if (result.error) {
      setMemoError(result.error);
      return;
    }
    const trimmed = memoInput.trim();
    const prevMemo = memo;
    setMemo(trimmed === '' ? null : trimmed);
    setMemoFormOpen(false);
    if (result.previous) {
      const previous = result.previous;
      pushUndo('メモを変更しました', async () => {
        const r = await restoreRowFieldsAction(previous);
        if (r.error) return r.error;
        setMemo(prevMemo);
        return null;
      });
    }
  }

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    const sign = transaction.amountYen < 0 ? -1 : 1;
    const payload = rows.map((r) => ({
      genreId: r.genreId || null,
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
        genreId: p.genreId,
        genreName: categories.find((c) => c.id === p.genreId)?.name ?? null,
        amountYen: p.amountYen,
        note: p.note,
      })),
    );
    setSaving(false);
    pushSplitsUndo(splits, '分割を保存しました');
    setOpen(false);
    setCategoryFormOpen(false);
  }

  /** 分割の変更を元に戻す(変更前の分割を書き戻す)。 */
  function pushSplitsUndo(prevSplits: readonly TransactionSplit[], message: string): void {
    pushUndo(message, async () => {
      const r = await replaceSplitsAction(
        transaction.id,
        prevSplits.map((p) => ({ genreId: p.genreId, amountYen: p.amountYen, note: p.note })),
      );
      if (r.error) return r.error;
      setSplits(prevSplits);
      setRows(initialRows(prevSplits, categories));
      setMode(prevSplits.length > 0 ? 'split' : 'simple');
      return null;
    });
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
    const prevSplits = splits;
    setSplits([]);
    setRows(initialRows([], categories));
    setSaving(false);
    pushSplitsUndo(prevSplits, '分割を解除しました');
    // 分割を解除した直後は「じゃあ1つのカテゴリで」が次にやりたいことの
    // はずなので、閉じずに単純なカテゴリ変更フォームへ戻す。
    setMode('simple');
  }

  const itemNames = items.map((it) => it.name);
  const uncategorized = !transaction.genreId && !isIncome && splits.length === 0;
  const predictions = uncategorized
    ? predictGenres({
        storeName: display?.name ?? transaction.description,
        itemNames,
        genres: categories,
        history: genreHistory,
      })
    : [];
  const shares = display?.shares ?? [];
  const subtitle = [
    display?.branch ?? null,
    itemNames.length > 0
      ? itemNames.slice(0, 3).join('、') +
        (itemNames.length > 3 ? ` ほか${itemNames.length - 3}点` : '')
      : null,
  ]
    .filter((x): x is string => x !== null && x !== '')
    .join(' ・ ');
  const rowAriaLabel = `${display?.name ?? transaction.description}、${transaction.genreName ?? '未分類'}、${isIncome ? '収入' : '支出'}${formatYen(targetAbsYen)}${display?.scheduled ? '、予定' : ''}`;

  async function changeGenre(newGenreId: string): Promise<void> {
    setGenreSheetOpen(false);
    setRowError(null);
    const result = await updateTransactionAction(transaction.id, newGenreId);
    if (result.error) {
      setRowError(result.error);
      return;
    }
    const prevGenreId = genreId;
    setGenreId(newGenreId);
    if (result.previous) {
      const previous = result.previous;
      pushUndo('ジャンルを変更しました', async () => {
        const r = await restoreRowFieldsAction(previous);
        if (r.error) return r.error;
        setGenreId(prevGenreId);
        return null;
      });
    }
    // 確定の手応え:行のアニメーションとハプティクス。
    setFlash(true);
    window.setTimeout(() => setFlash(false), 300);
    hapticFor('genreConfirm');
    // 直したジャンルは、次の分類から効くよう履歴へ反映する。
    void recordGenreCorrectionAction({
      storeName: display?.name ?? transaction.description,
      itemName: display?.name ?? transaction.description,
      genreId: newGenreId,
    });
  }

  async function toggleSpecial(): Promise<void> {
    setRowError(null);
    const next = !special;
    const result = await setTransactionKindAction(transaction.id, next ? 'special' : 'normal');
    if (result.error) {
      setRowError(result.error);
      return;
    }
    setSpecial(next);
    if (result.previous) {
      const previous = result.previous;
      pushUndo(next ? '特別費にしました' : '通常の支出に戻しました', async () => {
        const r = await restoreRowFieldsAction(previous);
        if (r.error) return r.error;
        setSpecial(!next);
        return null;
      });
    }
  }

  async function remove(): Promise<void> {
    setRowError(null);
    const result = await deleteTransactionAction(transaction.id);
    if (result.error) {
      setRowError(result.error);
      return;
    }
    setRemoved(true);
    setMenuOpen(false);
    hapticFor('deleteConfirm');
    const snapshot = result.snapshot;
    if (snapshot) {
      pushUndo('削除しました', async () => {
        const r = await restoreDeletedTransactionAction(snapshot);
        if (r.error) return r.error;
        setRemoved(false);
        return null;
      });
    }
  }

  async function duplicate(): Promise<void> {
    setRowError(null);
    setMenuOpen(false);
    const result = await duplicateTransactionAction(transaction.id);
    if (result.error) {
      setRowError(result.error);
      return;
    }
    const createdId = result.createdId;
    pushUndo('複製しました(「(複製)」の明細を編集してください)', async () => {
      if (!createdId) return '元に戻せませんでした。';
      const r = await deleteTransactionAction(createdId);
      return r.error;
    });
  }

  /** レシート付きの行:画像を読み取り直し、品目を更新する(更新は元に戻せる)。 */
  async function rereadReceipt(): Promise<void> {
    setMenuOpen(false);
    setRowError(null);
    const url = display?.thumbnailUrl;
    if (!url) return;
    try {
      const blob = await (await fetch(url)).blob();
      const image = await resizeToJpegBase64(new File([blob], 'receipt.jpg', { type: blob.type }));
      const response = await fetch('/api/import/receipt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image, mediaType: 'image/jpeg' }),
      });
      const result = (await response.json()) as {
        transactions?: {
          amountYen: number;
          items: { description: string; amountYen: number; productType: string | null }[];
        }[];
      };
      const parsed = result.transactions?.[0];
      if (!response.ok || !parsed || parsed.items.length === 0) {
        setRowError('読み取り直しても、品目は読み取れませんでした。');
        return;
      }
      const prevItems = items;
      const payload = parsed.items.map((i) => ({
        name: i.description,
        amountYen: (transaction.amountYen < 0 ? -1 : 1) * Math.abs(i.amountYen),
        genreId: transaction.genreId,
        productType: i.productType,
      }));
      const replaced = await replaceReceiptItemsAction(transaction.id, payload);
      if (replaced.error) {
        setRowError(replaced.error);
        return;
      }
      setItems(
        payload.map((p, i) => ({
          id: `reread-${i}`,
          name: p.name,
          amountYen: p.amountYen,
          genreId: p.genreId,
          genreName: transaction.genreName,
          productType: p.productType,
          sortOrder: i,
        })) as unknown as readonly ReceiptItem[],
      );
      pushUndo('読み取り直して品目を更新しました', async () => {
        const r = await replaceReceiptItemsAction(
          transaction.id,
          prevItems.map((p) => ({
            name: p.name,
            amountYen: p.amountYen,
            genreId: p.genreId,
            productType: p.productType,
          })),
        );
        if (r.error) return r.error;
        setItems(prevItems);
        return null;
      });
    } catch {
      setRowError('読み取り直せませんでした。通信状況を確かめてください。');
    }
  }

  if (removed) return null;

  return (
    <li className="py-1" style={display?.scheduled ? { opacity: 0.85 } : undefined}>
      <SwipeableRow
        onSwipeRight={() => setGenreSheetOpen(true)}
        onLongPress={() => setMenuOpen(true)}
        actions={
          <>
            <button
              type="button"
              onClick={() => void duplicate()}
              className="min-h-11 flex-1 text-xs font-semibold"
              style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
            >
              複製
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              className="min-h-11 flex-1 text-xs font-semibold"
              style={{ background: 'var(--ink)', color: 'var(--surface)' }}
            >
              削除
            </button>
          </>
        }
      >
        <div
          className={`flex items-center pr-2 ${flash ? 'row-flash' : ''} ${justSaved ? 'row-insert' : ''}`}
        >
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              // 閉じるときはカテゴリ編集フォームの開閉も一緒にリセットする。
              setOpen((v) => {
                const next = !v;
                if (!next) setCategoryFormOpen(false);
                return next;
              });
            }}
            className="min-h-11 flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
            aria-label={rowAriaLabel}
          >
            {uncategorized ? (
              // 未分類は「?」やグレーではなく、点線の空の丸。ジャンルは行の中のチップで選ぶ。
              <span
                aria-hidden
                className="size-8 shrink-0 rounded-full border border-dashed"
                style={{ borderColor: 'var(--ink-muted)' }}
              />
            ) : (
              <GenreBadge name={transaction.genreName} />
            )}
            <div className="min-w-0 flex-1">
              {/* 1行目:正規化した店名(切れないように折り返す) */}
              <p className="text-sm leading-snug break-words" style={{ color: 'var(--ink)' }}>
                {display?.name ?? transaction.description}
                {special ? (
                  <span
                    className="ml-2 rounded-full px-2 py-1 align-middle text-xs font-semibold"
                    style={{ background: 'var(--plane)', color: 'var(--ink-muted)' }}
                  >
                    特別費
                  </span>
                ) : null}
                {risky && methodLabel ? (
                  <span
                    className="ml-2 rounded-full px-2 py-1 align-middle text-xs font-semibold"
                    style={{ background: 'var(--attention-track)', color: 'var(--attention)' }}
                  >
                    {methodLabel}
                  </span>
                ) : null}
              </p>
              {/* 2行目:支店名と品目のプレビュー(分割は品目の羅列ではなく比率の細いバー) */}
              {subtitle !== '' ? (
                <p className="mt-1 truncate text-xs" style={{ color: 'var(--ink-muted)' }}>
                  {subtitle}
                </p>
              ) : null}
              {shares.length > 0 ? (
                <div
                  role="img"
                  aria-label={`ジャンルの内訳:${shares
                    .map((sh) => `${sh.genreName ?? '未分類'} ${Math.round(sh.ratio * 100)}%`)
                    .join('、')}`}
                  className="mt-2 flex h-2 w-full overflow-hidden rounded-full"
                >
                  {shares.map((sh) => (
                    <span
                      key={sh.genreId ?? 'none'}
                      style={{
                        width: `${sh.ratio * 100}%`,
                        background: genreBarColor(
                          sh.genreName,
                          sh.genreName ? overrides[sh.genreName] : null,
                        ),
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>

            <LedgerAmount
              amountYen={isIncome ? targetAbsYen : -targetAbsYen}
              className="shrink-0 text-sm font-semibold"
            />
          </button>
          <button
            type="button"
            aria-label="金額・日付・カテゴリを編集"
            onClick={() => {
              setMode(splits.length > 0 ? 'split' : 'simple');
              setOpen(true);
              setCategoryFormOpen(true);
            }}
            className="min-h-11 shrink-0 px-1 text-xs font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            編集
          </button>
          {/* レシート画像は小さなレシートアイコンに。タップでフルスクリーン表示 */}
          {display?.thumbnailUrl ? (
            <button
              type="button"
              aria-label="レシート画像を見る"
              onClick={() => setViewerOpen(true)}
              className="flex size-11 shrink-0 items-center justify-center rounded-full"
              style={{ color: 'var(--ink-muted)' }}
            >
              <MdReceiptLong aria-hidden size={20} />
            </button>
          ) : null}
        </div>
        {/* 未分類:行の中の「ジャンルを選ぶ」チップ。タップ → 予測上位3件 → 1タップで確定 */}
        <div className="pr-4 pb-1 pl-[60px]">
          <button
            type="button"
            onClick={() => setItemEditRequest((n) => n + 1)}
            className="min-h-11 text-xs font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            {items.length > 0 ? '品目を編集' : '品目を追加'}
          </button>
        </div>
        {uncategorized ? (
          <div className="pr-4 pb-3 pl-[60px]">
            <button
              type="button"
              onClick={() => setPickOpen(true)}
              className="min-h-11 rounded-full border px-4 text-sm font-semibold"
              style={{ borderColor: 'var(--ink-muted)', color: 'var(--ink)' }}
            >
              ジャンルを選ぶ
            </button>
          </div>
        ) : null}
      </SwipeableRow>
      {rowError ? (
        <p role="status" className="px-4 pb-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {rowError}
        </p>
      ) : null}

      <div className="px-4">
        {/* 品目のタップ導線(本人からの不具合報告「レシートの品目もどこから
          飛べばいいかわかりません...タップしても何も見れない」)。行を開くと
          単価付きの内訳が見える(以前はプレビューのテキストだけで、開いても
          カテゴリ編集フォームしか出ず品目自体は確認できなかった)。
          品目が無いときは、何も出さずに黙るのではなく「記録が無い」と
          明示する(本人発案「品目が不明な場合はその旨書いてくれ」)。表示・
          未登録時の再登録ボタンは家計簿(/spending)と共通の部品
          (receipt-items-panel.tsx、ADR-040)。 */}
        <div className={open ? 'mt-3' : undefined}>
          <ReceiptItemsPanel
            transaction={{
              id: transaction.id,
              occurredOn: transaction.occurredOn,
              accountId: transaction.accountId,
              paymentMethod: transaction.paymentMethod,
              amountYen: transaction.amountYen,
            }}
            categories={categories}
            items={items}
            onItemsReplaced={setItems}
            subtype={subtype}
            onSubtypeReplaced={setSubtype}
            summary={open}
            openRequest={itemEditRequest}
          />
        </div>

        {/* 明細への自由記述メモ(本人発案、issue #95)。カテゴリ・金額・日付
          とは独立した操作なので、別の開閉状態を持つ(このファイル冒頭の
          コメント参照)。 */}
        {open ? (
          <button
            type="button"
            onClick={() => void toggleSpecial()}
            aria-pressed={special}
            className="min-h-11 mt-3 text-xs font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            {special ? '特別費を通常の支出に戻す' : '特別費にする(目標のペースから除く)'}
          </button>
        ) : null}

        {open && !memoFormOpen ? (
          <div className="mt-3 flex items-start justify-between gap-2">
            {memo ? (
              <p
                className="min-w-0 flex-1 whitespace-pre-wrap text-xs"
                style={{ color: 'var(--ink-secondary)' }}
              >
                {memo}
              </p>
            ) : (
              <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                メモはありません
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setMemoInput(memo ?? '');
                setMemoFormOpen(true);
              }}
              className="min-h-11 shrink-0 text-xs font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              {memo ? 'メモを編集する' : 'メモを追加する'}
            </button>
          </div>
        ) : null}

        {open && memoFormOpen ? (
          <div
            className="mt-3 space-y-2 rounded-2xl border p-3"
            style={{ borderColor: 'var(--hairline)' }}
          >
            <textarea
              value={memoInput}
              onChange={(e) => setMemoInput(e.target.value)}
              rows={2}
              placeholder="メモ(任意)"
              className="w-full rounded-xl px-3 py-2 text-sm"
              style={{
                background: 'var(--plane)',
                color: 'var(--ink)',
                border: '1px solid var(--hairline)',
              }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void saveMemo()}
                disabled={memoSaving}
                className="min-h-11 flex-1 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
                style={{ background: 'var(--action)', color: 'var(--on-action)' }}
              >
                {memoSaving ? '保存中…' : '保存'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMemoInput(memo ?? '');
                  setMemoFormOpen(false);
                  setMemoError(null);
                }}
                className="min-h-11 rounded-full px-4 py-2 text-sm font-semibold"
                style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
              >
                やめる
              </button>
            </div>
            {memoError ? (
              <p className="text-xs" style={{ color: 'var(--over)' }}>
                {memoError}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* 品目の合計が明細額と一致しない(ADR-035)警告は、行には出さない。
          要確認カード(家計簿の上部)に集約し、そこから順に直す。 */}

        {/* 開いても品目(あれば)と現在の分類だけを見せ、カテゴリ編集は
          明示的に押すまで出さない(このファイル冒頭のコメント参照)。 */}
        {open && !showCategoryForm ? (
          <button
            type="button"
            onClick={() => setCategoryFormOpen(true)}
            className="min-h-11 mt-2 text-xs font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            金額・日付・カテゴリを編集する
          </button>
        ) : null}

        {open && showCategoryForm && mode === 'simple' ? (
          <div
            className="mt-3 space-y-2 rounded-2xl border p-3"
            style={{ borderColor: 'var(--hairline)' }}
          >
            <div className="flex gap-2">
              <input
                type="date"
                value={occurredOnInput}
                onChange={(e) => setOccurredOnInput(e.target.value)}
                className="flex-1 rounded-xl px-3 py-2 text-sm"
                style={{
                  background: 'var(--plane)',
                  color: 'var(--ink)',
                  border: '1px solid var(--hairline)',
                }}
              />
              <input
                type="text"
                inputMode="numeric"
                value={amountAbsYenInput}
                onChange={(e) => setAmountAbsYenInput(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="金額"
                className="flex-1 rounded-xl px-3 py-2 text-sm"
                style={{
                  background: 'var(--plane)',
                  color: 'var(--ink)',
                  border: '1px solid var(--hairline)',
                }}
              />
            </div>

            <select
              value={genreId}
              onChange={(e) => setGenreId(e.target.value)}
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
                onClick={() => void saveSimpleEdit()}
                disabled={saving || !canSaveSimpleEdit}
                className="min-h-11 flex-1 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
                style={{ background: 'var(--action)', color: 'var(--on-action)' }}
              >
                {saving ? '保存中…' : '保存'}
              </button>
              <button
                type="button"
                onClick={() => setMode('split')}
                className="min-h-11 rounded-full px-4 py-2 text-sm font-semibold"
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

        {open && showCategoryForm && mode === 'split' ? (
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
                    value={row.genreId}
                    onChange={(e) => updateRow(index, { genreId: e.target.value })}
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
                    className="min-h-11 shrink-0 px-2 text-xs"
                    style={{ color: 'var(--ink-muted)' }}
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
                  className="w-full rounded-xl px-3 py-2 text-xs"
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
                className="min-h-11 text-xs font-semibold"
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
                className="min-h-11 flex-1 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
                style={{ background: 'var(--action)', color: 'var(--on-action)' }}
              >
                {saving ? '保存中…' : '保存'}
              </button>
              {splits.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void clearSplits()}
                  disabled={saving}
                  className="min-h-11 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
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
                  className="min-h-11 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
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

        {/* 長押しのその場プレビュー(本人発案、ADR-042)。編集の入口は一切
          出さない——閲覧専用。行を開かなくても、その場で内容を確認できる。 */}
      </div>

      <BottomSheet open={pickOpen} onClose={() => setPickOpen(false)} role="dialog">
        <div className="space-y-2 px-2 pb-2">
          <p className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
            {display?.name ?? transaction.description} のジャンル
          </p>
          <ul className="space-y-2">
            {predictions.map((p) => (
              <li key={p.genreId}>
                <button
                  type="button"
                  onClick={() => {
                    setPickOpen(false);
                    void changeGenre(p.genreId);
                  }}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left"
                  style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
                >
                  <GenreBadge name={p.genreName} size={28} />
                  <span className="flex-1 text-sm font-semibold">{p.genreName}</span>
                  <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {p.reason === 'history'
                      ? 'いつもの'
                      : p.reason === 'dictionary'
                        ? '品目から'
                        : p.reason === 'store_type'
                          ? '店の種類から'
                          : 'よく使う'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setPickOpen(false);
              setGenreSheetOpen(true);
            }}
            className="min-h-11 text-sm font-semibold"
            style={{ color: 'var(--ink-secondary)' }}
          >
            ほかのジャンルから選ぶ →
          </button>
        </div>
      </BottomSheet>

      <BottomSheet open={menuOpen} onClose={() => setMenuOpen(false)} role="menu">
        <ul className="px-2 pb-2">
          {[
            {
              label: 'ジャンルを変更',
              run: () => {
                setMenuOpen(false);
                setGenreSheetOpen(true);
              },
            },
            {
              label: '分割する',
              run: () => {
                setMenuOpen(false);
                setOpen(true);
                setCategoryFormOpen(true);
                setMode('split');
              },
            },
            { label: '複製', run: () => void duplicate() },
            {
              label: '内容を見る',
              run: () => {
                setMenuOpen(false);
                setPreviewOpen(true);
              },
            },
            ...(display?.thumbnailUrl
              ? [
                  {
                    label: '画像を見る',
                    run: () => {
                      setMenuOpen(false);
                      setViewerOpen(true);
                    },
                  },
                  { label: 'もう一度読み取る', run: () => void rereadReceipt() },
                ]
              : []),
            { label: '削除', run: () => void remove(), danger: true },
          ].map((item) => (
            <li key={item.label}>
              <button
                type="button"
                role="menuitem"
                onClick={item.run}
                className="flex min-h-11 w-full items-center px-2 text-left text-base font-semibold"
                style={{ color: 'danger' in item && item.danger ? 'var(--over)' : 'var(--ink)' }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>

      {viewerOpen && display?.thumbnailUrl ? (
        <ReceiptImageViewer src={display.thumbnailUrl} onClose={() => setViewerOpen(false)} />
      ) : null}

      <BottomSheet open={genreSheetOpen} onClose={() => setGenreSheetOpen(false)} role="dialog">
        <div className="space-y-2 px-2 pb-2">
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            ジャンルを変更
          </p>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => void changeGenre(c.id)}
                className="min-h-11 rounded-full px-3 py-2 text-xs font-semibold"
                style={{
                  background:
                    c.id === (transaction.genreId ?? '') ? 'var(--accent)' : 'var(--accent-track)',
                  color:
                    c.id === (transaction.genreId ?? '') ? 'var(--on-accent)' : 'var(--accent)',
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={previewOpen} onClose={() => setPreviewOpen(false)} role="dialog">
        <div className="flex items-center justify-between px-3 pt-1 pb-2">
          <h2 className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
            明細のプレビュー
          </h2>
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            外側をタップで閉じる
          </span>
        </div>

        <div className="space-y-3 px-3 pb-3">
          <div>
            <p className="text-sm" style={{ color: 'var(--ink)' }}>
              {transaction.description}
            </p>
            <p className="text-sm font-semibold">
              <LedgerAmount amountYen={isIncome ? targetAbsYen : -targetAbsYen} />
            </p>
          </div>

          <div>
            <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
              分類
            </p>
            {splits.length > 0 ? (
              <ul className="mt-1 space-y-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
                {splits.map((s, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate">
                      {s.note ? `${s.note}(${s.genreName ?? '未分類'})` : (s.genreName ?? '未分類')}
                    </span>
                    <span className="tabular shrink-0">
                      {formatYen(Math.abs(s.amountYen), { sign: 'never' })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
                {transaction.genreName ?? '未分類'}
              </p>
            )}
            {subtype ? (
              <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                生活費の内訳:{subtype}
              </p>
            ) : null}
          </div>

          {items.length > 0 ? (
            <div>
              <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
                レシートの品目
              </p>
              <ul className="mt-1 space-y-1">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-baseline justify-between gap-3 text-xs"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    <span className="min-w-0 truncate">
                      {item.name}
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
              {splits.length === 0 && itemsStatus === 'mismatched' ? (
                <p className="mt-1 text-xs" style={{ color: 'var(--over)' }}>
                  品目の合計が金額と一致しません
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </BottomSheet>
    </li>
  );
}

function initialRows(
  splits: readonly TransactionSplit[],
  categories: readonly GenreOption[],
): SplitRowState[] {
  if (splits.length > 0) {
    return splits.map((s) => ({
      genreId: s.genreId ?? '',
      amountYen: String(Math.abs(s.amountYen)),
      note: s.note ?? '',
    }));
  }
  const first = categories[0]?.id ?? '';
  const second = categories[1]?.id ?? first;
  return [
    { genreId: first, amountYen: '', note: '' },
    { genreId: second, amountYen: '', note: '' },
  ];
}
