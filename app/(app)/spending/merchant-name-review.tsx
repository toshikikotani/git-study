'use client';

import { useRef, useState } from 'react';

import { BottomSheet, BottomSheetHeader } from '@/components/ui/bottom-sheet';
import type { MerchantNameReviewGroup, MerchantNameSnapshot } from '@/domain/merchant-name-review';
import { formatYen } from '@/domain/money';
import { formatDateJa } from '@/lib/date';
import { saveMerchantNameChangesAction } from './merchant-name-actions';

/** 確認が必要な店名(要確認の「店名をまとめて直す」から、規則で見つけたもの)。 */
export function MerchantNameReview({
  open,
  groups,
  onClose,
}: {
  open: boolean;
  groups: readonly MerchantNameReviewGroup[];
  onClose: () => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} label="店名をまとめて直す">
      <BottomSheetHeader className="flex items-center justify-between gap-3">
        <h2 className="text-[18px] font-semibold" style={{ color: 'var(--ink)' }}>
          店名をまとめて直す
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 px-2 text-sm font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          閉じる
        </button>
      </BottomSheetHeader>
      <MerchantNameResults groups={groups} />
    </BottomSheet>
  );
}

/** 店名の候補と、その直し方(シートの中身。AIでチェックのシートでも使う、ADR-120)。 */
export function MerchantNameResults({
  groups,
  error = null,
  warning = null,
}: {
  /** null は探している途中。 */
  groups: readonly MerchantNameReviewGroup[] | null;
  error?: string | null;
  /** AI が使えなかったなど、規則で探した分だけを出しているときの理由。 */
  warning?: string | null;
}) {
  const [saved, setSaved] = useState<ReadonlyMap<string, string>>(new Map());
  const remaining = (groups ?? [])
    .map((group) => ({
      ...group,
      entries: group.entries.filter((entry) => saved.get(entry.id) !== snapshotKey(entry)),
    }))
    .filter((group) => group.entries.length > 0);
  const count = remaining.reduce((sum, group) => sum + group.entries.length, 0);

  return (
    <>
      <p className="my-3 text-[13px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        候補は自動では保存されません。対象の明細と新しい店名・支店名を確かめてください。金額・日付・カテゴリと、取り込んだ原文は変わりません。
      </p>
      <p role="status" className="mb-3 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        {groups === null
          ? 'AIがすべての月の明細の店名を見比べています…(30秒ほどかかることがあります)'
          : error
            ? ''
            : count > 0
              ? `確認が必要な店名 ${count}件`
              : groups.length === 0
                ? '直す店名は見つかりませんでした'
                : '店名の確認が終わりました'}
      </p>
      {error ? (
        <p role="alert" className="mb-3 text-sm" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
      {warning ? (
        <p className="mb-3 text-[13px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          {warning} 決まった規則で見つけたものだけを出しています。
        </p>
      ) : null}
      {groups !== null && groups.length === 0 && !error ? (
        <p className="mb-3 text-[13px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          表記のゆれ・店名なし・住所のような店名を、すべての月の明細から探しました。
        </p>
      ) : null}
      <div className="space-y-3 pb-4">
        {remaining.map((group) => (
          <MerchantNameGroupEditor
            key={group.key}
            group={group}
            onSaved={(ids) =>
              setSaved((previous) => {
                const next = new Map(previous);
                for (const entry of group.entries)
                  if (ids.includes(entry.id)) next.set(entry.id, snapshotKey(entry));
                return next;
              })
            }
          />
        ))}
      </div>
    </>
  );
}

function snapshotKey(entry: MerchantNameSnapshot): string {
  return JSON.stringify([entry.merchantName, entry.description, entry.branchName, entry.updatedAt]);
}

/** 同じ現在名・支店の明細をまとめる。選択から外したものと保存失敗分は残す。 */
export function MerchantNameGroupEditor({
  group,
  onSaved,
}: {
  group: MerchantNameReviewGroup;
  onSaved: (ids: readonly string[]) => void;
}) {
  const [name, setName] = useState(group.suggestedName);
  const [branch, setBranch] = useState(group.suggestedBranch ?? '');
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    new Set(group.entries.map((entry) => entry.id)),
  );
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failures, setFailures] = useState<ReadonlyMap<string, string>>(new Map());
  const selectedEntries = group.entries.filter((entry) => selected.has(entry.id));
  const reason = group.reasons.includes('missing')
    ? '店名なし'
    : group.reasons.includes('address')
      ? '住所のような店名'
      : group.reasons.includes('ai')
        ? 'AIが見つけた表記ゆれ'
        : '店名の表記ゆれ';

  async function save() {
    if (saving.current || name.trim() === '' || selectedEntries.length === 0) return;
    saving.current = true;
    setBusy(true);
    setMessage(null);
    setFailures(new Map());
    const updatedIds: string[] = [];
    const failed = new Map<string, string>();
    let requestError: string | null = null;
    try {
      // APIの上限内で、確認した対象だけを順番に保存する。
      for (let index = 0; index < selectedEntries.length; index += 100) {
        const result = await saveMerchantNameChangesAction({
          changes: selectedEntries.slice(index, index + 100).map((entry) => ({
            snapshot: {
              id: entry.id,
              merchantName: entry.merchantName,
              description: entry.description,
              branchName: entry.branchName,
              updatedAt: entry.updatedAt,
            },
            name: name.trim(),
            branchName: branch.trim() || null,
          })),
        });
        updatedIds.push(...result.updatedIds);
        for (const failure of result.failed) failed.set(failure.id, failure.error);
        if (result.error) {
          requestError = result.error;
          break;
        }
      }
    } catch {
      requestError = '通信に失敗しました。保存できなかった明細は残しています。';
    } finally {
      saving.current = false;
      setBusy(false);
    }
    if (updatedIds.length > 0) onSaved(updatedIds);
    setSelected((previous) => new Set([...previous].filter((id) => !updatedIds.includes(id))));
    setFailures(failed);
    setMessage(
      requestError ??
        (failed.size > 0
          ? `${updatedIds.length}件を保存しました。保存できなかった${failed.size}件を確認してください。`
          : `${updatedIds.length}件を保存しました。`),
    );
  }

  return (
    <details
      className="rounded-2xl px-3"
      style={{ background: 'var(--plane)', color: 'var(--ink)' }}
    >
      <summary className="min-h-16 cursor-pointer py-3">
        <span className="text-[15px] font-semibold">
          {group.label}
          {group.branchName ? ` ${group.branchName}` : ''}
        </span>
        <span className="mt-1 block text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          {reason}・{group.entries.length}件
          {group.suggestedName ? ` → ${group.suggestedName}` : '・店名を入力'}
        </span>
      </summary>
      <div className="space-y-3 pb-4">
        <label className="block text-sm font-semibold">
          新しい店名
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            disabled={busy}
            autoComplete="off"
            className="mt-1 min-h-11 w-full rounded-xl px-3 text-base font-normal"
            style={{
              background: 'var(--surface)',
              color: 'var(--ink)',
              border: '1px solid var(--hairline)',
            }}
          />
        </label>
        <label className="block text-sm font-semibold">
          支店名（任意）
          <input
            type="text"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            maxLength={200}
            disabled={busy}
            autoComplete="off"
            className="mt-1 min-h-11 w-full rounded-xl px-3 text-base font-normal"
            style={{
              background: 'var(--surface)',
              color: 'var(--ink)',
              border: '1px solid var(--hairline)',
            }}
          />
        </label>
        {group.reasons.includes('address') ? (
          <p className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            住所から店名は判断できないため、レシートなどで確認して入力してください。
          </p>
        ) : null}
        <fieldset disabled={busy}>
          <legend className="mb-1 text-sm font-semibold">変更する明細を選択</legend>
          <div className="flex gap-4 text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>
            <button
              type="button"
              onClick={() => setSelected(new Set(group.entries.map((entry) => entry.id)))}
              className="min-h-11"
            >
              すべて選択
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="min-h-11">
              選択を解除
            </button>
          </div>
          <ul>
            {group.entries.map((entry) => (
              <li key={entry.id} className="border-t" style={{ borderColor: 'var(--hairline)' }}>
                <label className="flex min-h-14 items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(entry.id)}
                    onChange={() =>
                      setSelected((previous) => {
                        const next = new Set(previous);
                        if (next.has(entry.id)) next.delete(entry.id);
                        else next.add(entry.id);
                        return next;
                      })
                    }
                    className="size-5 shrink-0"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-[13px]">
                      {formatDateJa(entry.occurredOn)}・{formatYen(Math.abs(entry.amountYen))}
                    </span>
                    <span className="break-words text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                      {entry.description}
                    </span>
                  </span>
                </label>
                {failures.has(entry.id) ? (
                  <p role="alert" className="pb-2 text-[12px]" style={{ color: 'var(--over)' }}>
                    {failures.get(entry.id)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </fieldset>
        {message ? (
          <p
            role={failures.size > 0 ? 'alert' : 'status'}
            className="text-[13px]"
            style={{ color: failures.size > 0 ? 'var(--over)' : 'var(--ink-secondary)' }}
          >
            {message}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy || selectedEntries.length === 0 || name.trim() === ''}
          onClick={save}
          className="min-h-11 w-full rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--action)', color: 'var(--on-action)' }}
        >
          {busy ? '保存中…' : `選んだ${selectedEntries.length}件の店名を保存`}
        </button>
      </div>
    </details>
  );
}
