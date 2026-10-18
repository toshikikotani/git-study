'use client';

import { useRef, useState } from 'react';

import {
  applyReceiptFixes,
  type ReceiptCheckGroup,
  type ReceiptCheckItem,
  type ReceiptFix,
} from '@/domain/receipt-check';
import { formatYen } from '@/domain/money';
import { formatDateJa } from '@/lib/date';
import { pushUndo } from '@/lib/undo';
import { replaceReceiptItemsAction } from '../transactions/actions';
import { saveReceiptItemFixAction } from './receipt-check-actions';

/** レシートの品目の読み取りミスの候補と、その直し方(AIでチェックのシートの中身、ADR-120)。 */
export function ReceiptCheckResults({
  groups,
  error = null,
  warning = null,
}: {
  /** null は探している途中。 */
  groups: readonly ReceiptCheckGroup[] | null;
  error?: string | null;
  /** AI が使えなかったなど、規則で探した分だけを出しているときの理由。 */
  warning?: string | null;
}) {
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const count = (groups ?? []).filter((g) => !saved.has(g.entry.transactionId)).length;

  return (
    <>
      <p className="my-3 text-[13px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        候補は自動では保存されません。直す内容を選んでから保存してください。明細の金額・日付・カテゴリは変わりません。
      </p>
      <p role="status" className="mb-3 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        {groups === null
          ? 'AIが最近のレシートの品目を読み直しています…(30秒ほどかかることがあります)'
          : error
            ? ''
            : count > 0
              ? `確認が必要なレシート ${count}件`
              : groups.length === 0
                ? '読み取りミスは見つかりませんでした'
                : 'レシートの確認が終わりました'}
      </p>
      {error ? (
        <p role="alert" className="mb-3 text-sm" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
      {warning ? (
        <p className="mb-3 text-[13px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          {warning} 決まった規則で見つけたもの(小計・お預りなどの行)だけを出しています。
        </p>
      ) : null}
      {groups !== null && groups.length === 0 && !error ? (
        <p className="mb-3 text-[13px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          品名の読み違い・品目ではない行・桁の読み違いを、最近のレシートから探しました。
        </p>
      ) : null}
      <div className="space-y-3 pb-4">
        {(groups ?? []).map((group) => (
          <ReceiptFixEditor
            key={group.entry.transactionId}
            group={group}
            onSavedChange={(isSaved) =>
              setSaved((previous) => {
                const next = new Set(previous);
                if (isSaved) next.add(group.entry.transactionId);
                else next.delete(group.entry.transactionId);
                return next;
              })
            }
          />
        ))}
      </div>
    </>
  );
}

/** 候補が何をするかを、今の品目と並べて書く。 */
export function describeReceiptFix(fix: ReceiptFix, item: ReceiptCheckItem | undefined): string {
  const name = item?.name ?? '';
  if (fix.kind === 'remove') return `「${name}」の行を消す`;
  if (fix.kind === 'rename') return `「${name}」→「${fix.name ?? ''}」`;
  return `「${name}」 ${formatYen(Math.abs(item?.amountYen ?? 0))} → ${formatYen(fix.amountYen ?? 0)}`;
}

type Phase = 'idle' | 'saving' | 'saved' | 'undoing' | 'undone';

/** 1枚のレシートの候補。選んだものだけを当て、直したあとの品目を見せてから保存する。 */
export function ReceiptFixEditor({
  group,
  onSavedChange,
}: {
  group: ReceiptCheckGroup;
  onSavedChange: (saved: boolean) => void;
}) {
  const { entry, fixes } = group;
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    new Set(fixes.map((fix) => fix.key)),
  );
  const [phase, setPhase] = useState<Phase>('idle');
  const busy = useRef(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const itemById = new Map(entry.items.map((item) => [item.id, item]));
  const chosen = fixes.filter((fix) => selected.has(fix.key));
  const fixed = applyReceiptFixes(entry, chosen);
  const locked = phase !== 'idle';

  async function save() {
    if (busy.current || !fixed || chosen.length === 0) return;
    busy.current = true;
    setPhase('saving');
    setMessage(null);
    let error: string | null;
    try {
      error = (
        await saveReceiptItemFixAction({
          transactionId: entry.transactionId,
          expectedItemIds: entry.items.map((item) => item.id),
          items: fixed.items,
        })
      ).error;
    } catch {
      error = '通信に失敗しました。もう一度お試しください。';
    }
    busy.current = false;
    if (error) {
      setPhase('idle');
      setMessage({ text: error, error: true });
      return;
    }
    setPhase('saved');
    setMessage({ text: '品目を直しました。', error: false });
    onSavedChange(true);
    // シートを閉じたあとも、画面下の「元に戻す」から戻せる。
    pushUndo('レシートの品目を直しました', restore);
  }

  /** 直す前の品目に戻す(シートの「元に戻す」と、画面下の「元に戻す」で共通)。 */
  async function restore(): Promise<string | null> {
    try {
      return (
        await replaceReceiptItemsAction(
          entry.transactionId,
          entry.items.map((item) => ({
            name: item.name,
            amountYen: item.amountYen,
            genreId: item.genreId,
            productType: item.productType,
          })),
        )
      ).error;
    } catch {
      return '通信に失敗しました。もう一度お試しください。';
    }
  }

  async function undo() {
    if (busy.current) return;
    busy.current = true;
    setPhase('undoing');
    const error = await restore();
    busy.current = false;
    if (error) {
      setPhase('saved');
      setMessage({ text: error, error: true });
      return;
    }
    setPhase('undone');
    setMessage({ text: '元に戻しました。', error: false });
    onSavedChange(false);
  }

  return (
    <details
      className="rounded-2xl px-3"
      style={{ background: 'var(--plane)', color: 'var(--ink)' }}
    >
      <summary className="min-h-16 cursor-pointer py-3">
        <span className="text-[15px] font-semibold">{entry.storeName}</span>
        <span className="mt-1 block text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          {formatDateJa(entry.occurredOn)}・{formatYen(Math.abs(entry.amountYen))}・
          {phase === 'saved' ? '直しました' : `直す候補 ${fixes.length}件`}
        </span>
      </summary>
      <div className="space-y-3 pb-4">
        <fieldset disabled={locked}>
          <legend className="mb-1 text-sm font-semibold">直す内容を選択</legend>
          <ul>
            {fixes.map((fix) => (
              <li key={fix.key} className="border-t" style={{ borderColor: 'var(--hairline)' }}>
                <label className="flex min-h-14 items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(fix.key)}
                    onChange={() =>
                      setSelected((previous) => {
                        const next = new Set(previous);
                        if (next.has(fix.key)) next.delete(fix.key);
                        else next.add(fix.key);
                        return next;
                      })
                    }
                    className="size-5 shrink-0"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="break-words text-[13px]">
                      {describeReceiptFix(fix, itemById.get(fix.itemId))}
                    </span>
                    <span className="break-words text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                      {fix.reason}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        {fixed && chosen.length > 0 ? (
          <div className="rounded-xl px-3 py-2" style={{ background: 'var(--surface)' }}>
            <p className="text-[12px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
              直したあとの品目
            </p>
            <ul className="mt-1 space-y-1">
              {fixed.items.map((item, i) => (
                <li
                  key={i}
                  className="flex items-baseline justify-between gap-3 text-[12px]"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  <span className="min-w-0 break-words">{item.name}</span>
                  <span className="tabular shrink-0">
                    {formatYen(item.amountYen, { sign: 'never' })}
                  </span>
                </li>
              ))}
            </ul>
            {fixed.rebalanced ? (
              <p className="mt-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                支払額 {formatYen(Math.abs(entry.amountYen))} に合わせて、金額を配り直しています。
              </p>
            ) : null}
          </div>
        ) : null}
        {message ? (
          <p
            role={message.error ? 'alert' : 'status'}
            className="text-[13px]"
            style={{ color: message.error ? 'var(--over)' : 'var(--ink-secondary)' }}
          >
            {message.text}
          </p>
        ) : null}
        {phase === 'saved' || phase === 'undoing' ? (
          <button
            type="button"
            disabled={phase === 'undoing'}
            onClick={undo}
            className="min-h-11 w-full rounded-full border px-4 py-2 text-sm font-semibold disabled:opacity-40"
            style={{ borderColor: 'var(--hairline)', color: 'var(--accent)' }}
          >
            {phase === 'undoing' ? '戻しています…' : '元に戻す'}
          </button>
        ) : phase === 'undone' ? null : (
          <button
            type="button"
            disabled={locked || !fixed || chosen.length === 0}
            onClick={save}
            className="min-h-11 w-full rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--action)', color: 'var(--on-action)' }}
          >
            {phase === 'saving' ? '保存中…' : `選んだ${chosen.length}件を直して保存`}
          </button>
        )}
      </div>
    </details>
  );
}
