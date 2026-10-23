'use client';

import { useMemo, useState } from 'react';

import { ReceiptImageViewer } from '@/components/receipt/receipt-image-viewer';
import { GenreBadge } from '@/components/ui/genre-badge';
import { Segmented } from '@/components/ui/segmented';
import {
  goalImpact,
  needsKindChoice,
  type GoalSnapshot,
  type ImpactDelta,
} from '@/domain/goal-impact';
import { formatYen } from '@/domain/money';
import type { PriceBasis, ReceiptDraft, ReceiptLine, TaxRate } from '@/domain/receipt-reconcile';
import {
  checkQuestions,
  currentParsed,
  emptyGenreLines,
  genreLineIds,
  itemLines,
  paidYenOf,
  reconcileOf,
  saveBlock,
  WHOLE,
  type CheckContext,
  type CheckQuestion,
  type CheckState,
} from '@/features/import/receipt-check';
import type { UnsavedReceipt } from '@/features/import/unsaved-receipts';
import { weekdayOf } from '@/lib/date';
import { BottomSheet, BottomSheetHeader } from '@/components/ui/bottom-sheet';
import { GenrePickerSheet, type GenreScope, type GenreSuggestion } from '../../genre-picker-sheet';
import type { ReceiptDuplicateHit } from '../actions';

/**
 * 保存前のレシートを確かめる画面(v5 変更3・変更5、ADR-133)。「要約を見て、違う行だけ押して直す」形。
 * 上から:画像の帯(押すと全画面)→ 同じ支払いかも → 確かめること(1問ずつ)→ 要約の5行 →
 * 合計の答え合わせ1行 → 品目 → 詳細(たたむ)。下に固定:目標への影響の1行と「保存」(ほかにもあれば「次へ」)。
 *
 * 値は親(receipt-results.tsx)が持つ(次へ・戻るで直した内容を失わない)。ここは見せ方と、押したときに
 * 値を変えることだけ。保存は本人が「保存」を押したときだけ。
 */

const WEEKDAY = '日月火水木金土';
/** 2026-10-22 → 22日（木） */
export function dayLabel(date: string): string {
  return `${Number(date.slice(8, 10))}日（${WEEKDAY[weekdayOf(date)]}）`;
}
/** 2026-10-22 → 10/22 */
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

export type AccountChoice = { id: string; name: string };
type Row = 'store' | 'date' | 'total' | 'account' | null;

const IMPACT_REASON: Record<string, string> = {
  special: '特別費なので、目標のペースには含めません',
  scheduled: '今日より先の予定なので、目標のペースには含めません',
  outside_period: '目標の期間の外なので、目標には含めません',
  no_target: '目標のあるカテゴリではないので、目標には含めません',
};

const BLOCK_LABEL = {
  must: '答えると保存できます',
  genre: 'カテゴリを選んでください',
  account: '支払いを選んでください',
  amount: '合計を入れてください',
} as const;

export function ReceiptCheck({
  receipt,
  state,
  onChange,
  ctx,
  genres,
  accounts,
  goal,
  position,
  saving,
  duplicates,
  mergeChoice,
  onMergeChoice,
  onSave,
  onNext,
  onDiscard,
  onJoinNext,
  joining,
  toast,
}: {
  receipt: UnsavedReceipt;
  state: CheckState;
  onChange: (update: (s: CheckState) => CheckState) => void;
  ctx: CheckContext;
  genres: readonly { id: string; name: string }[];
  accounts: readonly AccountChoice[];
  goal: { snapshot: GoalSnapshot; today: string } | null;
  /** 保存前のうちの何件め / 全部で何件。 */
  position: { index: number; total: number };
  saving: boolean;
  /** 同じ支払いかもしれない記録(カードの通知メールなど)。 */
  duplicates: readonly ReceiptDuplicateHit[];
  mergeChoice: 'merge' | 'separate' | null;
  onMergeChoice: (choice: 'merge' | 'separate') => void;
  onSave: () => void;
  onNext: (() => void) | null;
  onDiscard: () => void;
  /** 次の保存前のレシートとつなげる(長いレシートを2枚で撮ったとき)。次が無ければ null。 */
  onJoinNext: (() => void) | null;
  joining: boolean;
  /** 保存・取り消しの知らせ(シートの中に出す)。 */
  toast: React.ReactNode;
}) {
  const [row, setRow] = useState<Row>(null);
  const [viewer, setViewer] = useState(false);
  const [itemSheet, setItemSheet] = useState<string | null>(null);
  const [picker, setPicker] = useState<{
    kind: 'lines';
    lineIds: string[];
    suggested: string | null;
    fromItem: string | null;
  } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [details, setDetails] = useState(false);
  const [undo, setUndo] = useState<{ message: string; previous: CheckState } | null>(null);

  const nameOf = useMemo(() => new Map(genres.map((g) => [g.id, g.name])), [genres]);
  const accountName = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const questions = useMemo(() => checkQuestions(receipt, state, ctx), [receipt, state, ctx]);
  const block = saveBlock(receipt, state, questions);
  const reconcile = reconcileOf(state);
  const lines = itemLines(receipt, state);
  const paid = paidYenOf(state);
  const parsed = useMemo(() => currentParsed(receipt, state), [receipt, state]);
  const emptyLines = new Set(emptyGenreLines(receipt, state));
  const question = questions[0] ?? null;

  const answer = (ids: readonly string[], update: (s: CheckState) => CheckState = (s) => s) =>
    onChange((s) => {
      const next = update(s);
      return { ...next, answered: new Set([...next.answered, ...ids]) };
    });
  const updateDraft = (fn: (d: ReceiptDraft) => ReceiptDraft) =>
    onChange((s) => (s.draft === null ? s : { ...s, draft: fn(s.draft) }));
  const setPaid = (yen: number) =>
    answer(['total'], (s) =>
      s.draft === null ? { ...s, amountYen: yen } : { ...s, draft: { ...s.draft, paidYen: yen } },
    );
  const setGenres = (lineIds: readonly string[], genreId: string | null, message?: string) => {
    if (message) setUndo({ message, previous: state });
    answer(
      lineIds.map((id) => `line:${id}`),
      (s) => {
        const map = new Map(s.genreByLineId);
        for (const id of lineIds) map.set(id, genreId);
        return { ...s, genreByLineId: map };
      },
    );
  };

  // 目標への影響:品目ごとのカテゴリで動く額。
  const deltas = useMemo<ImpactDelta[]>(
    () =>
      parsed.items.length === 0
        ? [{ genreId: state.genreByLineId.get(WHOLE) ?? null, amountYen: paid }]
        : parsed.items.map((item) => ({
            genreId: state.genreByLineId.get(item.lineId ?? '') ?? null,
            amountYen: Math.abs(item.amountYen),
          })),
    [parsed.items, state.genreByLineId, paid],
  );
  const impact =
    goal === null
      ? null
      : goalImpact(goal.snapshot, {
          occurredOn: state.occurredOn,
          today: goal.today,
          kind: 'normal',
          deltas,
        });
  const choice =
    goal === null
      ? { needed: false }
      : needsKindChoice(goal.snapshot, { occurredOn: state.occurredOn, today: goal.today, deltas });

  // 要約のカテゴリ:品目のカテゴリをまとめて1行に。
  const allLineIds = genreLineIds(receipt, state);
  const genreIds = allLineIds.map((id) => state.genreByLineId.get(id) ?? null);
  const chosen = [...new Set(genreIds.filter((g): g is string => g !== null))];
  const categorySummary =
    emptyLines.size > 0
      ? lines.length > 0
        ? `未選択 ${emptyLines.size}品目`
        : '未選択'
      : chosen.length === 0
        ? '未選択'
        : chosen.length === 1
          ? (nameOf.get(chosen[0]!) ?? '')
          : `${nameOf.get(chosen[0]!) ?? ''} ほか${chosen.length - 1}`;

  const suggestionsFor = (
    suggested: string | null,
    lineIds: readonly string[],
  ): GenreSuggestion[] => {
    const out: GenreSuggestion[] = [];
    if (suggested) {
      out.push({
        genreId: suggested,
        reason: lineIds.length > 1 ? `${lineIds.length}品目の候補` : '品名とお店から',
      });
    }
    const parent = receipt.parentGenreId;
    if (parent && parent !== suggested) out.push({ genreId: parent, reason: 'お店の種類から' });
    return out;
  };

  const editingLine =
    itemSheet === null ? null : (state.draft?.lines.find((l) => l.id === itemSheet) ?? null);

  return (
    <div className="flex flex-col" style={{ color: 'var(--ink)' }}>
      <BottomSheetHeader>
        <div className="flex min-h-11 items-center justify-between gap-2 py-1">
          <p className="text-[17px] font-semibold">
            レシートを確かめる
            {position.total > 1 ? (
              <span
                className="tabular ml-2 text-[13px] font-normal"
                style={{ color: 'var(--ink-muted)' }}
              >
                {position.index + 1} / {position.total}
              </span>
            ) : null}
          </p>
          <button
            type="button"
            onClick={onDiscard}
            className="min-h-11 px-2 text-[15px]"
            style={{ color: 'var(--ink-secondary)' }}
          >
            捨てる
          </button>
        </div>
      </BottomSheetHeader>

      <div className="flex flex-col gap-4 pb-4">
        {/* 1. 画像:細長い帯。押すと全画面で拡大できる。 */}
        {receipt.imageUrl ? (
          <button
            type="button"
            onClick={() => setViewer(true)}
            aria-label="レシートの画像を大きく見る"
            className="relative h-[120px] min-h-11 w-full overflow-hidden rounded-2xl"
            style={{ background: '#111' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={receipt.imageUrl} alt="" className="size-full object-cover object-top" />
            <span
              className="absolute right-2 bottom-2 rounded-full px-3 py-1 text-[12px] font-semibold"
              style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}
            >
              押すと大きく
            </span>
          </button>
        ) : null}
        {viewer && receipt.imageUrl ? (
          <ReceiptImageViewer src={receipt.imageUrl} onClose={() => setViewer(false)} />
        ) : null}

        {receipt.warnings.length > 0 ? (
          <ul
            className="flex flex-col gap-1 px-1 text-[13px]"
            style={{ color: 'var(--ink-muted)' }}
          >
            {receipt.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : null}

        {/* 2. 同じ支払いかも:重なりそうなときだけ。 */}
        {duplicates.length > 0 ? (
          <section
            aria-label="同じ支払いかも"
            className="flex flex-col gap-3 rounded-2xl px-4 py-3"
            style={{
              background: 'var(--surface)',
              boxShadow: 'inset 0 0 0 1px var(--state-caution)',
            }}
          >
            <p className="text-[15px] font-semibold">同じ支払いかも</p>
            <p className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
              {duplicates[0]!.fromEmail ? 'カードの通知メールの' : 'もうある記録の'}「
              {duplicates[0]!.storeName} {formatYen(Math.abs(duplicates[0]!.amountYen))}」(
              {md(duplicates[0]!.occurredOn)})と重なりそうです。
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['merge', '1件にまとめる'],
                  ['separate', '別の記録にする'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mergeChoice === value}
                  onClick={() => onMergeChoice(value)}
                  className="min-h-11 rounded-xl px-3 text-[15px] font-semibold"
                  style={{
                    background: mergeChoice === value ? 'var(--note)' : 'var(--plane)',
                    boxShadow: mergeChoice === value ? 'inset 0 0 0 2px var(--accent)' : 'none',
                    color: 'var(--ink)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* 3. 確かめること:聞くと決めたものだけ、自信のない順に1問ずつ。 */}
        {question ? (
          <QuestionCard
            key={question.id}
            question={question}
            count={questions.length}
            receipt={receipt}
            state={state}
            nameOf={nameOf}
            accounts={accounts}
            onAnswer={answer}
            onSetPaid={setPaid}
            onGenre={(lineIds, genreId) => setGenres(lineIds, genreId)}
            onOtherGenre={(q) =>
              setPicker({
                kind: 'lines',
                lineIds: q.lineIds,
                suggested: q.suggestedGenreId,
                fromItem: null,
              })
            }
            onOpenRow={setRow}
            onOpenItem={setItemSheet}
          />
        ) : null}

        {/* 要約の5行:左に項目名、右に値。押した行だけがその場で入力になる。 */}
        <section
          aria-label="要約"
          className="flex flex-col overflow-hidden rounded-2xl [&>*+*]:border-t [&>*+*]:border-[var(--hairline)]"
          style={{ background: 'var(--surface)' }}
        >
          <SummaryRow
            label="お店"
            value={state.store || '(店名なし)'}
            open={row === 'store'}
            onToggle={() => setRow(row === 'store' ? null : 'store')}
          >
            <input
              aria-label="お店"
              defaultValue={state.store}
              autoFocus
              maxLength={60}
              onChange={(e) => {
                const value = e.target.value;
                answer(['store'], (s) => ({ ...s, store: value }));
              }}
              className="min-h-11 w-full rounded-xl px-3 text-[16px]"
              style={{ background: 'var(--field)', color: 'var(--ink)' }}
            />
          </SummaryRow>
          <SummaryRow
            label="日付"
            value={dayLabel(state.occurredOn)}
            open={row === 'date'}
            onToggle={() => setRow(row === 'date' ? null : 'date')}
          >
            <input
              type="date"
              aria-label="日付"
              value={state.occurredOn}
              autoFocus
              onChange={(e) => {
                const value = e.target.value;
                if (value) answer(['date'], (s) => ({ ...s, occurredOn: value }));
              }}
              className="min-h-11 w-full rounded-xl px-3 text-[16px]"
              style={{ background: 'var(--field)', color: 'var(--ink)' }}
            />
          </SummaryRow>
          <SummaryRow
            label="合計"
            value={formatYen(paid)}
            open={row === 'total'}
            onToggle={() => setRow(row === 'total' ? null : 'total')}
            tabular
          >
            {state.draft === null && parsed.items.length > 0 ? (
              <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                品目から出した合計です。品目を直すと変わります。
              </p>
            ) : (
              <input
                aria-label="合計(円)"
                inputMode="numeric"
                autoFocus
                defaultValue={String(paid)}
                onChange={(e) => setPaid(Number(e.target.value.replace(/[^0-9]/g, '') || '0'))}
                className="tabular min-h-11 w-full rounded-xl px-3 text-[20px] font-semibold"
                style={{ background: 'var(--field)', color: 'var(--ink)' }}
              />
            )}
          </SummaryRow>
          <SummaryRow
            label="支払い"
            value={state.accountId ? (accountName.get(state.accountId) ?? '口座') : '未選択'}
            open={row === 'account'}
            onToggle={() => setRow(row === 'account' ? null : 'account')}
          >
            <div role="radiogroup" aria-label="支払い" className="flex flex-col gap-1">
              {accounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={a.id === state.accountId}
                  onClick={() => {
                    answer(['account'], (s) => ({ ...s, accountId: a.id }));
                    setRow(null);
                  }}
                  className="flex min-h-11 items-center justify-between rounded-xl px-3 text-left text-[15px]"
                  style={{ background: a.id === state.accountId ? 'var(--note)' : 'var(--plane)' }}
                >
                  {a.name}
                  {a.id === state.accountId ? <span aria-hidden>✓</span> : null}
                </button>
              ))}
            </div>
          </SummaryRow>
          <SummaryRow
            label="カテゴリ"
            value={categorySummary}
            caution={emptyLines.size > 0}
            open={false}
            onToggle={() =>
              setPicker({
                kind: 'lines',
                lineIds: allLineIds,
                suggested: chosen[0] ?? null,
                fromItem: null,
              })
            }
          />
        </section>

        {/* 4. 合計の答え合わせ:1行だけ。 */}
        {reconcile !== null ? (
          <div className="flex flex-col gap-2 px-1" role="status" aria-live="polite">
            {reconcile.status === 'ok' ? (
              <p className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
                <span aria-hidden style={{ color: 'var(--income)' }}>
                  ✓{' '}
                </span>
                品目の合計と合っています
              </p>
            ) : (
              <>
                <p className="text-[15px] font-semibold" style={{ color: 'var(--state-caution)' }}>
                  {reconcile.diffYen > 0
                    ? `品目が${formatYen(reconcile.diffYen)}足りません`
                    : `品目が${formatYen(-reconcile.diffYen)}多いです`}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const id = `manual-${Date.now()}`;
                      const add = reconcile.diffYen > 0;
                      updateDraft((d) => ({
                        ...d,
                        lines: [
                          ...d.lines,
                          {
                            id,
                            name: add ? '品目' : '値引き',
                            amountYen: Math.abs(reconcile.diffYen),
                            kind: add ? 'item' : 'discount',
                            taxRate: null,
                            genreId: null,
                            confidence: 1,
                            yRatio: null,
                          },
                        ],
                      }));
                      setItemSheet(id);
                    }}
                    className="min-h-11 rounded-full px-4 text-[15px] font-semibold"
                    style={{ background: 'var(--surface)', color: 'var(--ink)' }}
                  >
                    {reconcile.diffYen > 0 ? '品目を足す' : '値引きを足す'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRow('total')}
                    className="min-h-11 rounded-full px-4 text-[15px] font-semibold"
                    style={{ background: 'var(--surface)', color: 'var(--ink)' }}
                  >
                    合計を直す
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {/* 5. 品目:1行に品名・金額・カテゴリのマーク。 */}
        {lines.length > 0 ? (
          <section aria-label="品目" className="flex flex-col gap-2">
            <div className="flex min-h-11 items-center justify-between px-1">
              <h3 className="text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                品目 {lines.length}点
              </h3>
              {state.draft !== null ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelecting(!selecting);
                    setSelected(new Set());
                  }}
                  className="min-h-11 px-1 text-[15px] font-semibold"
                  style={{ color: 'var(--accent)' }}
                >
                  {selecting ? 'やめる' : '選んで変える'}
                </button>
              ) : null}
            </div>
            <ul
              className="flex flex-col overflow-hidden rounded-2xl [&>*+*]:border-t [&>*+*]:border-[var(--hairline)]"
              style={{ background: 'var(--surface)' }}
            >
              {lines.map((line) => {
                const genreId = state.genreByLineId.get(line.lineId) ?? null;
                const name = genreId ? (nameOf.get(genreId) ?? null) : null;
                const on = selected.has(line.lineId);
                return (
                  <li key={line.lineId}>
                    <button
                      type="button"
                      aria-pressed={selecting ? on : undefined}
                      onClick={() => {
                        if (selecting) {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(line.lineId)) next.delete(line.lineId);
                            else next.add(line.lineId);
                            return next;
                          });
                        } else if (state.draft !== null) setItemSheet(line.lineId);
                        else
                          setPicker({
                            kind: 'lines',
                            lineIds: [line.lineId],
                            suggested: genreId,
                            fromItem: line.name,
                          });
                      }}
                      className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left"
                      style={{ background: on ? 'var(--note)' : undefined }}
                    >
                      {selecting ? (
                        <span
                          aria-hidden
                          className="flex size-6 shrink-0 items-center justify-center rounded-full text-[13px]"
                          style={{
                            background: on ? 'var(--accent)' : 'transparent',
                            color: 'var(--on-accent)',
                            boxShadow: on ? 'none' : 'inset 0 0 0 2px var(--hairline)',
                          }}
                        >
                          {on ? '✓' : ''}
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate text-[15px]">{line.name}</span>
                      <span className="tabular shrink-0 text-[15px]">
                        {formatYen(line.amountYen)}
                      </span>
                      {name ? (
                        <GenreBadge name={name} size={28} />
                      ) : (
                        <span
                          aria-label="カテゴリ未選択"
                          className="flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
                          style={{
                            background: 'var(--state-caution-track)',
                            color: 'var(--caution-mark)',
                          }}
                        >
                          ?
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {selecting && selected.size > 0 ? (
              <button
                type="button"
                onClick={() =>
                  setPicker({
                    kind: 'lines',
                    lineIds: [...selected],
                    suggested: null,
                    fromItem: null,
                  })
                }
                className="btn-primary min-h-11 rounded-full text-[15px] font-semibold"
              >
                {selected.size}品目のカテゴリを変える
              </button>
            ) : null}
            {state.draft !== null && !selecting ? (
              <button
                type="button"
                onClick={() => {
                  const id = `manual-${Date.now()}`;
                  updateDraft((d) => ({
                    ...d,
                    lines: [
                      ...d.lines,
                      {
                        id,
                        name: '品目',
                        amountYen: 0,
                        kind: 'item',
                        taxRate: null,
                        genreId: null,
                        confidence: 1,
                        yRatio: null,
                      },
                    ],
                  }));
                  setItemSheet(id);
                }}
                className="min-h-11 self-start px-1 text-[15px] font-semibold"
                style={{ color: 'var(--accent)' }}
              >
                ＋ 品目を足す
              </button>
            ) : null}
          </section>
        ) : null}

        {/* 6. 詳細(たたんでおく)。 */}
        <section className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={details}
            onClick={() => setDetails(!details)}
            className="flex min-h-11 items-center justify-between px-1 text-[15px] font-semibold"
            style={{ color: 'var(--ink-secondary)' }}
          >
            詳細(税率・値引き・ポイント・割り勘・メモ)
            <span aria-hidden>{details ? '−' : '+'}</span>
          </button>
          {details ? (
            <Details
              state={state}
              onChange={onChange}
              onOpenItem={setItemSheet}
              onJoinNext={onJoinNext}
              joining={joining}
            />
          ) : null}
        </section>
      </div>

      {/* 下に固定:目標への影響の1行と、大きな「保存」。 */}
      <div
        className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        style={{
          background: 'var(--sheet-background, var(--plane))',
          boxShadow: '0 -12px 24px -20px rgba(0, 0, 0, 0.35)',
        }}
      >
        {undo ? (
          <InlineToast
            message={undo.message}
            onUndo={() => {
              onChange(() => undo.previous);
              setUndo(null);
            }}
            onClose={() => setUndo(null)}
          />
        ) : null}
        {toast}
        {impact !== null ? <ImpactLine impact={impact} /> : null}
        <div className="flex gap-2">
          {onNext ? (
            <button
              type="button"
              onClick={onNext}
              className="min-h-12 rounded-full px-5 text-[15px] font-semibold"
              style={{ background: 'var(--field)', color: 'var(--ink)' }}
            >
              次へ
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSave}
            disabled={saving || block !== null}
            className="btn-primary min-h-12 flex-1 rounded-full px-4 text-[17px] font-semibold"
          >
            {saving
              ? '保存しています…'
              : block !== null
                ? BLOCK_LABEL[block]
                : choice.needed
                  ? '目標に含めて保存'
                  : '保存'}
          </button>
        </div>
      </div>

      <GenrePickerSheet
        open={picker !== null}
        onClose={() => setPicker(null)}
        title={
          picker && picker.lineIds.length > 1
            ? `${picker.lineIds.length}品目のカテゴリ`
            : picker?.fromItem
              ? `「${picker.fromItem}」のカテゴリ`
              : 'カテゴリ'
        }
        selectedId={
          picker && picker.lineIds.length === 1
            ? (state.genreByLineId.get(picker.lineIds[0]!) ?? null)
            : null
        }
        suggestions={picker ? suggestionsFor(picker.suggested, picker.lineIds) : []}
        scope={
          picker?.fromItem
            ? { itemName: picker.fromItem, canApplyToAll: allLineIds.length > 1 }
            : undefined
        }
        onPick={(genreId, options: { scope: GenreScope; remember: boolean }) => {
          if (!picker || genreId === null) return;
          const ids = options.scope === 'all' ? allLineIds : picker.lineIds;
          setGenres(ids, genreId, `${nameOf.get(genreId) ?? ''}にしました`);
          if (options.remember && picker.fromItem) {
            onChange((s) => ({ ...s, remember: new Set([...(s.remember ?? []), ...ids]) }));
          }
          setSelecting(false);
          setSelected(new Set());
        }}
      />

      <ItemSheet
        line={editingLine}
        genreName={
          editingLine ? (nameOf.get(state.genreByLineId.get(editingLine.id) ?? '') ?? null) : null
        }
        onClose={() => setItemSheet(null)}
        onChange={(patch) => {
          if (!editingLine) return;
          const id = editingLine.id;
          answer([`item:${id}`], (s) =>
            s.draft === null
              ? s
              : {
                  ...s,
                  draft: {
                    ...s.draft,
                    lines: s.draft.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)),
                  },
                },
          );
        }}
        onPickGenre={() => {
          if (!editingLine) return;
          const line = editingLine;
          setItemSheet(null);
          setPicker({
            kind: 'lines',
            lineIds: [line.id],
            suggested: state.genreByLineId.get(line.id) ?? null,
            fromItem: line.name,
          });
        }}
        onRemove={() => {
          if (!editingLine) return;
          const id = editingLine.id;
          setUndo({ message: `「${editingLine.name}」を消しました`, previous: state });
          updateDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== id) }));
          setItemSheet(null);
        }}
      />
    </div>
  );
}

function SummaryRow({
  label,
  value,
  open,
  onToggle,
  caution = false,
  tabular = false,
  children,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  caution?: boolean;
  tabular?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        aria-expanded={children ? open : undefined}
        onClick={onToggle}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left"
      >
        <span className="shrink-0 text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
          {label}
        </span>
        <span
          className={`min-w-0 truncate text-right text-[17px] ${tabular ? 'tabular' : ''} ${caution ? 'font-semibold' : ''}`}
          style={{ color: caution ? 'var(--state-caution)' : 'var(--ink)' }}
        >
          {value}
          <span aria-hidden className="ml-2" style={{ color: 'var(--ink-muted)' }}>
            ›
          </span>
        </span>
      </button>
      {open && children ? <div className="px-4 pb-3">{children}</div> : null}
    </div>
  );
}

function QuestionCard({
  question,
  count,
  receipt,
  state,
  nameOf,
  accounts,
  onAnswer,
  onSetPaid,
  onGenre,
  onOtherGenre,
  onOpenRow,
  onOpenItem,
}: {
  question: CheckQuestion;
  count: number;
  receipt: UnsavedReceipt;
  state: CheckState;
  nameOf: ReadonlyMap<string, string>;
  accounts: readonly AccountChoice[];
  onAnswer: (ids: readonly string[], update?: (s: CheckState) => CheckState) => void;
  onSetPaid: (yen: number) => void;
  onGenre: (lineIds: readonly string[], genreId: string) => void;
  onOtherGenre: (q: Extract<CheckQuestion, { field: 'category' }>) => void;
  onOpenRow: (row: Row) => void;
  onOpenItem: (lineId: string) => void;
}) {
  const choices: { label: string; onClick: () => void; main?: boolean }[] = [];
  let text = '';
  switch (question.field) {
    case 'store':
      text = 'お店の名前は合っていますか？';
      choices.push(
        { label: state.store || '(店名なし)', onClick: () => onAnswer(['store']), main: true },
        { label: '直す', onClick: () => onOpenRow('store') },
      );
      break;
    case 'date':
      text = 'いつの買い物ですか？';
      for (const d of question.candidates) {
        choices.push({
          label: dayLabel(d),
          onClick: () => onAnswer(['date'], (s) => ({ ...s, occurredOn: d })),
          main: d === state.occurredOn,
        });
      }
      choices.push({ label: '別の日', onClick: () => onOpenRow('date') });
      break;
    case 'total':
      text = '払った合計はいくらですか？';
      question.candidates.forEach((yen, i) =>
        choices.push({
          label: i === 0 ? formatYen(yen) : `品目の合計 ${formatYen(yen)}`,
          onClick: () => onSetPaid(yen),
          main: i === 0,
        }),
      );
      choices.push({ label: '別の金額', onClick: () => onOpenRow('total') });
      break;
    case 'account': {
      text = '何で払いましたか？';
      const ordered = [
        ...accounts.filter((a) => a.id === state.accountId),
        ...accounts.filter((a) => a.id !== state.accountId),
      ].slice(0, 3);
      for (const a of ordered) {
        choices.push({
          label: a.name,
          onClick: () => onAnswer(['account'], (s) => ({ ...s, accountId: a.id })),
          main: a.id === state.accountId,
        });
      }
      if (accounts.length > 3)
        choices.push({ label: 'ほかから選ぶ', onClick: () => onOpenRow('account') });
      break;
    }
    case 'category': {
      const names = question.names;
      text =
        names.length > 1
          ? `この${names.length}品目は${question.suggestedGenreId ? `${nameOf.get(question.suggestedGenreId) ?? ''}？` : '何のカテゴリ？'}`
          : `「${names[0]}」は${question.suggestedGenreId ? `${nameOf.get(question.suggestedGenreId) ?? ''}？` : '何のカテゴリ？'}`;
      const candidates = [question.suggestedGenreId, receipt.parentGenreId, ...nameOf.keys()]
        .filter((g): g is string => g !== null && nameOf.has(g))
        .filter((g, i, all) => all.indexOf(g) === i)
        .slice(0, 3);
      for (const g of candidates) {
        choices.push({
          label: nameOf.get(g)!,
          onClick: () => onGenre(question.lineIds, g),
          // 必ず選ぶ(自信なし)ときは、何も当てていないので目立たせない。
          main: question.ask === 'ask' && g === question.suggestedGenreId,
        });
      }
      choices.push({ label: 'ほかから選ぶ', onClick: () => onOtherGenre(question) });
      break;
    }
    case 'item':
      text = `「${question.name}」${formatYen(question.amountYen)}で合っていますか？`;
      choices.push(
        { label: '合っている', onClick: () => onAnswer([question.id]), main: true },
        { label: '直す', onClick: () => onOpenItem(question.lineId) },
      );
      break;
  }

  return (
    <section
      aria-label="確かめること"
      className="flex flex-col gap-3 rounded-2xl px-4 py-3"
      style={{ background: 'var(--surface)', boxShadow: 'inset 0 0 0 1px var(--state-caution)' }}
    >
      <p
        className="flex items-center justify-between text-[13px] font-semibold"
        style={{ color: 'var(--ink-muted)' }}
      >
        <span>確かめること{count > 1 ? ` · あと${count}つ` : ''}</span>
        <span>
          {question.ask === 'must' ? '答えると保存できます' : '答えなければ、このまま保存します'}
        </span>
      </p>
      {receipt.imageUrl && question.yRatio !== null ? (
        <div
          className="h-[72px] w-full overflow-hidden rounded-xl"
          style={{ background: '#111' }}
          aria-hidden
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={receipt.imageUrl}
            alt=""
            className="size-full object-cover"
            style={{ objectPosition: `50% ${Math.round(question.yRatio * 100)}%` }}
          />
        </div>
      ) : null}
      <p className="text-[17px] font-semibold">{text}</p>
      <div className="flex flex-wrap gap-2">
        {choices.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={c.onClick}
            className="min-h-11 rounded-full px-4 text-[15px] font-semibold"
            style={
              c.main
                ? { background: 'var(--action)', color: 'var(--on-action)' }
                : { background: 'var(--plane)', color: 'var(--ink)' }
            }
          >
            {c.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function Details({
  state,
  onChange,
  onOpenItem,
  onJoinNext,
  joining,
}: {
  state: CheckState;
  onChange: (update: (s: CheckState) => CheckState) => void;
  onOpenItem: (lineId: string) => void;
  onJoinNext: (() => void) | null;
  joining: boolean;
}) {
  const draft = state.draft;
  const setDraft = (patch: Partial<ReceiptDraft>) =>
    onChange((s) => (s.draft === null ? s : { ...s, draft: { ...s.draft, ...patch } }));
  const discounts = draft?.lines.filter((l) => l.kind === 'discount') ?? [];
  const rateCount = (rate: TaxRate | null) =>
    draft?.lines.filter((l) => l.kind === 'item' && l.taxRate === rate).length ?? 0;

  return (
    <div
      className="flex flex-col gap-3 rounded-2xl px-4 py-3"
      style={{ background: 'var(--surface)' }}
    >
      {draft !== null ? (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
              税率
            </span>
            <Segmented<PriceBasis>
              label="価格の表示"
              value={draft.priceBasis}
              options={[
                { value: 'tax_included', label: '税込の表示' },
                { value: 'tax_excluded', label: '税抜の表示' },
              ]}
              onChange={(priceBasis) => setDraft({ priceBasis })}
              className="self-start"
            />
            <p className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
              8% {rateCount(8)}点 · 10% {rateCount(10)}点
              {rateCount(null) + rateCount(0) > 0
                ? ` · 不明 ${rateCount(null) + rateCount(0)}点`
                : ''}
              (品目を押すと直せます)
            </p>
          </div>
          {discounts.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                値引き
              </span>
              {discounts.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => onOpenItem(l.id)}
                  className="flex min-h-11 items-center justify-between text-[15px]"
                >
                  <span className="truncate">{l.name}</span>
                  <span className="tabular">−{formatYen(l.amountYen)}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-3 gap-2">
            <NumberField
              label="ポイント"
              value={draft.pointsYen}
              onChange={(v) => setDraft({ pointsYen: v })}
            />
            <NumberField
              label="クーポン"
              value={draft.couponYen}
              onChange={(v) => setDraft({ couponYen: v })}
            />
            <NumberField
              label="割り勘でもらった"
              value={draft.splitYen}
              onChange={(v) =>
                onChange((s) =>
                  s.draft === null
                    ? s
                    : {
                        ...s,
                        draft: {
                          ...s.draft,
                          splitYen: v,
                          paidYen: Math.max(0, s.draft.paidYen - (v - s.draft.splitYen)),
                        },
                      },
                )
              }
            />
          </div>
        </>
      ) : null}
      <label className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
          メモ
        </span>
        <input
          value={state.memo}
          maxLength={200}
          onChange={(e) => {
            const memo = e.target.value;
            onChange((s) => ({ ...s, memo }));
          }}
          placeholder="任意"
          className="min-h-11 rounded-xl px-3 text-[16px]"
          style={{ background: 'var(--field)', color: 'var(--ink)' }}
        />
      </label>
      <button
        type="button"
        onClick={onJoinNext ?? undefined}
        disabled={onJoinNext === null || joining}
        className="min-h-11 self-start px-1 text-[15px] font-semibold disabled:opacity-40"
        style={{ color: 'var(--accent)' }}
      >
        {joining ? 'つなげて読み直しています…' : '次の画像とつなげる'}
      </button>
      {onJoinNext === null ? (
        <p className="-mt-2 px-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          長いレシートを2枚で撮ったら、続けて撮った画像と1枚につなげられます
        </p>
      ) : null}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
        {label}(円)
      </span>
      <input
        inputMode="numeric"
        value={String(value)}
        onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9]/g, '') || '0'))}
        className="tabular min-h-11 w-full rounded-xl px-2 text-[16px]"
        style={{ background: 'var(--field)', color: 'var(--ink)' }}
      />
    </label>
  );
}

/** 「品目を直す」シート(v5-5):品名・金額・カテゴリ。「この品目を消す」もここに置く。 */
function ItemSheet({
  line,
  genreName,
  onClose,
  onChange,
  onPickGenre,
  onRemove,
}: {
  line: ReceiptLine | null;
  genreName: string | null;
  onClose: () => void;
  onChange: (patch: Partial<ReceiptLine>) => void;
  onPickGenre: () => void;
  onRemove: () => void;
}) {
  const discount = line?.kind === 'discount';
  return (
    <BottomSheet open={line !== null} onClose={onClose} role="dialog" label="品目を直す">
      {line ? (
        <div className="flex flex-col gap-4 px-3 pb-4" style={{ color: 'var(--ink)' }}>
          <BottomSheetHeader>
            <div className="flex min-h-11 items-center justify-between py-1">
              <p className="text-[17px] font-semibold">
                {discount ? '値引きを直す' : '品目を直す'}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 px-2 text-[15px] font-semibold"
                style={{ color: 'var(--accent)' }}
              >
                閉じる
              </button>
            </div>
          </BottomSheetHeader>
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
              品名
            </span>
            <input
              value={line.name}
              maxLength={60}
              onChange={(e) => onChange({ name: e.target.value })}
              className="min-h-11 rounded-xl px-3 text-[16px]"
              style={{ background: 'var(--field)', color: 'var(--ink)' }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
              金額(円)
            </span>
            <input
              inputMode="numeric"
              value={String(line.amountYen)}
              onChange={(e) =>
                onChange({ amountYen: Number(e.target.value.replace(/[^0-9]/g, '') || '0') })
              }
              className="tabular min-h-11 rounded-xl px-3 text-[20px] font-semibold"
              style={{ background: 'var(--field)', color: 'var(--ink)' }}
            />
          </label>
          {!discount ? (
            <>
              <button
                type="button"
                onClick={onPickGenre}
                className="flex min-h-12 items-center justify-between rounded-xl px-3 text-left"
                style={{ background: 'var(--plane)' }}
              >
                <span className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
                  カテゴリ
                </span>
                <span className="flex items-center gap-2 text-[17px]">
                  {genreName ? <GenreBadge name={genreName} size={24} /> : null}
                  {genreName ?? '未選択'}
                  <span aria-hidden style={{ color: 'var(--ink-muted)' }}>
                    ›
                  </span>
                </span>
              </button>
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                  税率
                </span>
                <Segmented<'8' | '10' | 'none'>
                  label="税率"
                  value={line.taxRate === 8 ? '8' : line.taxRate === 10 ? '10' : 'none'}
                  options={[
                    { value: '8', label: '8%' },
                    { value: '10', label: '10%' },
                    { value: 'none', label: '不明' },
                  ]}
                  onChange={(v) =>
                    onChange({ taxRate: v === 'none' ? null : (Number(v) as TaxRate) })
                  }
                  className="self-start"
                />
              </div>
            </>
          ) : null}
          <button
            type="button"
            onClick={onRemove}
            className="min-h-11 self-start px-1 text-[15px] font-semibold"
            style={{ color: 'var(--over)' }}
          >
            {discount ? 'この値引きを消す' : 'この品目を消す'}
          </button>
        </div>
      ) : null}
    </BottomSheet>
  );
}

/** 保存すると目標がどうなるかの1行。 */
function ImpactLine({ impact }: { impact: ReturnType<typeof goalImpact> }) {
  const first = impact.rows[0];
  if (!impact.counts && impact.reason !== 'included') {
    return (
      <p className="px-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        {IMPACT_REASON[impact.reason]}
      </p>
    );
  }
  if (!first) return null;
  return (
    <p className="tabular px-1 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
      保存すると {first.genreName}の残り {formatYen(first.beforeRemainingYen)} →{' '}
      <span
        className="font-semibold"
        style={{ color: first.afterRemainingYen < 0 ? 'var(--over)' : 'var(--ink)' }}
      >
        {first.afterRemainingYen < 0
          ? `${formatYen(-first.afterRemainingYen)}こえる`
          : formatYen(first.afterRemainingYen)}
      </span>
      {impact.rows.length > 1 ? ` ほか${impact.rows.length - 1}` : ''}
    </p>
  );
}

/** シートの中に出す「元に戻す」つきの知らせ。 */
export function InlineToast({
  message,
  onUndo,
  onClose,
  undoing = false,
}: {
  message: string;
  onUndo: (() => void) | null;
  onClose: () => void;
  undoing?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 rounded-2xl px-4 py-2 text-[15px]"
      style={{ background: 'var(--ink)', color: 'var(--surface)' }}
    >
      <span className="min-w-0">{message}</span>
      <span className="flex shrink-0 items-center">
        {onUndo ? (
          <button
            type="button"
            onClick={onUndo}
            disabled={undoing}
            className="min-h-11 px-3 font-semibold underline disabled:opacity-50"
          >
            {undoing ? '戻しています…' : '元に戻す'}
          </button>
        ) : null}
        <button type="button" aria-label="閉じる" onClick={onClose} className="min-h-11 min-w-11">
          ×
        </button>
      </span>
    </div>
  );
}
