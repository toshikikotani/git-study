'use client';

import { useState } from 'react';

import { ZoomableImage } from '@/components/receipt/zoomable-image';
import { ExpandableSheet } from '@/components/ui/expandable-sheet';
import { Yen } from '@/components/ui/money';
import type { TxPatch } from '@/features/category/edits';
import type { CategoryLine } from '@/features/category/model';
import type { SheetState } from '@/lib/sheet';
import { CategoryPicker } from './category-picker';

/**
 * 取引の編集シート。半分の高さで開き、上へスワイプすると全画面になる。
 * レシート付きの取引は、上部に画像を出す(ピンチ・ダブルタップでズーム)。金額・日付・店名・
 * メモ・品目を編集でき、カテゴリは格子から1タップで移せる。品目は1つだけ別のカテゴリへ移せる。
 * キーボードが入力欄を隠さないよう、シートがキーボードの高さぶん持ち上がる。
 */
export function EditSheet({
  line,
  genres,
  suggestedGenreId,
  onClose,
  onSave,
  onMove,
  onMoveItem,
}: {
  line: CategoryLine | null;
  genres: readonly { id: string; name: string }[];
  suggestedGenreId: string | null;
  onClose: () => void;
  onSave: (line: CategoryLine, patch: TxPatch) => void;
  onMove: (line: CategoryLine, toGenreId: string | null) => void;
  onMoveItem: (line: CategoryLine, itemId: string, toGenreId: string | null) => void;
}) {
  const [state, setState] = useState<Exclude<SheetState, 'closed'>>('half');
  return (
    <ExpandableSheet
      open={line !== null}
      state={state}
      onState={setState}
      onClose={() => {
        setState('half');
        onClose();
      }}
      label="取引の編集"
    >
      {line ? (
        <EditForm
          key={line.txId}
          line={line}
          genres={genres}
          suggestedGenreId={suggestedGenreId}
          full={state === 'full'}
          onSave={onSave}
          onMove={onMove}
          onMoveItem={onMoveItem}
        />
      ) : null}
    </ExpandableSheet>
  );
}

export function EditForm({
  line,
  genres,
  suggestedGenreId,
  full,
  onSave,
  onMove,
  onMoveItem,
}: {
  line: CategoryLine;
  genres: readonly { id: string; name: string }[];
  suggestedGenreId: string | null;
  full: boolean;
  onSave: (line: CategoryLine, patch: TxPatch) => void;
  onMove: (line: CategoryLine, toGenreId: string | null) => void;
  onMoveItem: (line: CategoryLine, itemId: string, toGenreId: string | null) => void;
}) {
  const tx = line.tx;
  const isSplit = tx.splits.length > 0;
  const [amount, setAmount] = useState(String(Math.abs(tx.amountYen)));
  const [date, setDate] = useState(tx.occurredOn);
  const [store, setStore] = useState(tx.label);
  const [memo, setMemo] = useState(tx.memo ?? '');
  const [picking, setPicking] = useState<null | { itemId: string | null }>(null);

  const amountNumber = Number(amount);
  const sign = tx.amountYen < 0 ? -1 : 1;
  const patch: TxPatch = {};
  if (
    !isSplit &&
    Number.isInteger(amountNumber) &&
    amountNumber > 0 &&
    sign * amountNumber !== tx.amountYen
  ) {
    patch.amountYen = sign * amountNumber;
  }
  if (date !== '' && date !== tx.occurredOn) patch.occurredOn = date;
  if (store.trim() !== '' && store.trim() !== tx.label) patch.label = store.trim();
  if ((memo.trim() === '' ? null : memo.trim()) !== (tx.memo ?? null)) {
    patch.memo = memo.trim() === '' ? null : memo.trim();
  }
  const dirty = Object.keys(patch).length > 0;

  return (
    <div className="space-y-4">
      {tx.thumbnailUrl ? (
        <ZoomableImage
          src={tx.thumbnailUrl}
          alt="レシート画像"
          highlightRatio={null}
          className={full ? 'h-72 overflow-hidden rounded-xl' : 'h-40 overflow-hidden rounded-xl'}
        />
      ) : null}

      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold break-words" style={{ color: 'var(--ink)' }}>
          {tx.label}
        </h2>
        <Yen value={Math.abs(line.amountYen)} className="shrink-0 text-base font-semibold" />
      </div>
      {line.receiptTotalYen !== null ? (
        <p className="tabular text-xs" style={{ color: 'var(--ink-secondary)' }}>
          このカテゴリの分です。レシート全体は {line.receiptTotalYen.toLocaleString('ja-JP')}円
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="金額(円)">
          <input
            inputMode="numeric"
            value={amount}
            disabled={isSplit}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            className="tabular min-h-11 w-full rounded-xl px-3 text-base disabled:opacity-60"
            style={inputStyle}
          />
        </Field>
        <Field label="日付">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="min-h-11 w-full rounded-xl px-3 text-base"
            style={inputStyle}
          />
        </Field>
      </div>
      {isSplit ? (
        <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
          分割したレシートの金額は、分割を解除してから直せます。
        </p>
      ) : null}

      <Field label="店名">
        <input
          value={store}
          onChange={(e) => setStore(e.target.value)}
          className="min-h-11 w-full rounded-xl px-3 text-base"
          style={inputStyle}
        />
      </Field>
      <Field label="メモ">
        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="任意"
          className="min-h-11 w-full rounded-xl px-3 text-base"
          style={inputStyle}
        />
      </Field>

      <div>
        <p className="mb-1 text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
          カテゴリ
        </p>
        {picking !== null && picking.itemId === null ? (
          <CategoryPicker
            genres={genres}
            currentId={tx.genreId}
            suggestedId={suggestedGenreId}
            includeUncategorized
            onPick={(g) => {
              setPicking(null);
              onMove(line, g);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setPicking({ itemId: null })}
            className="min-h-11 rounded-full px-4 text-sm font-semibold"
            style={{ border: '1px solid var(--hairline)', color: 'var(--ink)' }}
          >
            {tx.genreName ?? '未分類'} ・ カテゴリを移す →
          </button>
        )}
      </div>

      {tx.items.length > 0 ? (
        <div>
          <p className="mb-1 text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
            品目(1つだけ別のカテゴリへ移せます)
          </p>
          <ul className="divider-list">
            {tx.items.map((item) => (
              <li key={item.id} className="py-1">
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <span className="min-w-0 text-sm break-words" style={{ color: 'var(--ink)' }}>
                    {item.name}
                    <span className="ml-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
                      {item.genreName ?? tx.genreName ?? '未分類'}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Yen value={Math.abs(item.amountYen)} className="text-sm" />
                    <button
                      type="button"
                      onClick={() => setPicking({ itemId: item.id })}
                      aria-label={`${item.name}を別のカテゴリへ移す`}
                      className="min-h-11 px-2 text-xs font-semibold"
                      style={{ color: 'var(--ink)' }}
                    >
                      移す
                    </button>
                  </span>
                </div>
                {picking?.itemId === item.id ? (
                  <div className="pb-2">
                    <CategoryPicker
                      genres={genres}
                      currentId={item.genreId ?? tx.genreId}
                      onPick={(g) => {
                        setPicking(null);
                        onMoveItem(line, item.id, g);
                      }}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <button
        type="button"
        disabled={!dirty}
        onClick={() => onSave(line, patch)}
        className="min-h-12 w-full rounded-2xl text-base font-semibold disabled:opacity-40"
        style={{ background: 'var(--action)', color: 'var(--on-action)' }}
      >
        保存する
      </button>
    </div>
  );
}

const inputStyle = {
  background: 'var(--surface-raised)',
  color: 'var(--ink)',
  border: '1px solid var(--hairline)',
} as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </span>
      {children}
    </label>
  );
}
