'use client';

import { useEffect, useMemo, useState } from 'react';

import { ZoomableImage } from '@/components/receipt/zoomable-image';
import { STATE_COLOR, STATE_ICON, STATE_LABEL, STATE_TRACK } from '@/domain/budget-state';
import {
  goalImpact,
  goalToastMessage,
  needsKindChoice,
  type GoalSnapshot,
  type ImpactDelta,
} from '@/domain/goal-impact';
import { formatYen } from '@/domain/money';
import {
  applyFix,
  linesByTaxRate,
  reconcileReceipt,
  type PriceBasis,
  type ReceiptDraft,
  type ReceiptLine,
  type ReconcileSuggestion,
  type TaxRate,
} from '@/domain/receipt-reconcile';
import { withDraft, type ParsedReceiptTransaction } from '@/features/import/receipt-ai';
import type { JobClassification, ReceiptJob } from '@/features/import/receipt-queue';
import { buildReceiptSavePlan, type ReceiptSavePlan } from '@/features/import/receipt-save';
import type { GenreOption } from '@/features/transactions/genres-client';
import { checkReceiptDuplicatesAction } from '../actions';

/** これ未満の確からしさの項目には、黄色の下線を引く。 */
const LOW_CONFIDENCE = 0.7;

const RATE_LABEL: Record<string, string> = {
  '8': '軽減税率 8%',
  '10': '標準税率 10%',
  '0': '非課税・不明',
  null: '税率不明',
};

export type ReceiptConfirmSave = {
  plan: ReceiptSavePlan;
  /** 保存前に本人が直したジャンル(履歴へ反映する)。 */
  corrections: { itemName: string; genreId: string }[];
  storeName: string;
  imageBase64: string | null;
  /** 保存後のトースト用:目標への影響のひと言(目標が無ければ null)。 */
  goalMessage: string | null;
};

function underline(low: boolean): React.CSSProperties {
  return low
    ? {
        textDecoration: 'underline',
        textDecorationColor: 'var(--attention)',
        textDecorationThickness: '2px',
        textUnderlineOffset: '4px',
      }
    : {};
}

function initialGenres(
  job: ReceiptJob,
  index: number,
  parsed: ParsedReceiptTransaction,
): Map<string, string | null> {
  const byKey = new Map<string, JobClassification>(job.classifications.map((c) => [c.key, c]));
  const map = new Map<string, string | null>();
  parsed.items.forEach((item, j) => {
    if (item.lineId !== undefined)
      map.set(item.lineId, byKey.get(`${index}:${j}`)?.genreId ?? null);
  });
  return map;
}

export function ReceiptConfirm({
  job,
  index,
  genres,
  accountId,
  saving,
  savedLabel,
  goal,
  onSave,
  onDiscard,
}: {
  job: ReceiptJob;
  index: number;
  genres: readonly GenreOption[];
  accountId: string;
  saving: boolean;
  /** 保存済みなら表示する文言(保存ボタンの代わり)。 */
  savedLabel: string | null;
  /** 今の目標と実績(目標があるとき)。保存前 → 保存後の残り予算を出す。 */
  goal: { snapshot: GoalSnapshot; today: string } | null;
  onSave: (input: ReceiptConfirmSave) => void;
  onDiscard: () => void;
}) {
  const original = job.parsed[index]!;
  const [draft, setDraft] = useState<ReceiptDraft | null>(original.draft ?? null);
  const [store, setStore] = useState(original.storeName ?? original.description);
  const [occurredOn, setOccurredOn] = useState(original.occurredOn);
  const [genreByLineId, setGenreByLineId] = useState(() => initialGenres(job, index, original));
  const [parentGenreId, setParentGenreId] = useState<string | null>(
    job.parentGenreIds[index] ?? null,
  );
  const [kind, setKind] = useState<'normal' | 'special'>('normal');
  // 未来日・高額のとき、含める/特別費のどちらかを本人が選ぶまで保存できない。
  const [kindChosen, setKindChosen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<number>(0);

  const initialGenreMap = useMemo(
    () => initialGenres(job, index, original),
    [job, index, original],
  );
  const genreName = useMemo(() => new Map(genres.map((g) => [g.id, g.name])), [genres]);

  // 品目の按分・照合は、下書きから毎回同じ関数で作り直す(サーバーと同じ結果)。
  const current = useMemo<ParsedReceiptTransaction>(() => {
    if (draft === null) return { ...original, storeName: store, occurredOn };
    const productTypes = new Map(original.items.map((i) => [i.lineId ?? '', i.productType]));
    return {
      ...original,
      storeName: store,
      occurredOn,
      ...withDraft(original, draft, productTypes),
    };
  }, [original, draft, store, occurredOn]);
  const reconcile = useMemo(
    () =>
      draft !== null && draft.lines.some((l) => l.kind === 'item') ? reconcileReceipt(draft) : null,
    [draft],
  );

  // 重複の警告(同じ店・同じ日・近い金額)。日付・店・金額を直したら取り直す。
  const paidYen = draft?.paidYen ?? Math.abs(original.amountYen);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void checkReceiptDuplicatesAction([
        { key: 'r', storeName: store, occurredOn, amountYen: -paidYen },
      ]).then((r) => {
        if (!cancelled) setDuplicates(r.duplicates.r?.length ?? 0);
      });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [store, occurredOn, paidYen]);

  const update = (fn: (d: ReceiptDraft) => ReceiptDraft) =>
    setDraft((d) => (d === null ? d : fn(d)));
  const updateLine = (id: string, patch: Partial<ReceiptLine>) =>
    update((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));

  const selectedLine = draft?.lines.find((l) => selected.size === 1 && selected.has(l.id)) ?? null;
  const lowStore = (original.fieldConfidence?.store ?? 1) < LOW_CONFIDENCE;
  const lowDate = (original.fieldConfidence?.date ?? 1) < LOW_CONFIDENCE;
  const lowTotal = (original.fieldConfidence?.total ?? 1) < LOW_CONFIDENCE;

  const setGenreFor = (ids: Iterable<string>, genreId: string | null) =>
    setGenreByLineId((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.set(id, genreId);
      return next;
    });

  const groups = draft ? linesByTaxRate(draft) : [];
  const status = reconcile?.status ?? null;

  // 目標への影響:この支払いがジャンルごとに動かす額(品目のジャンル、無ければ明細のジャンル)。
  const deltas = useMemo<ImpactDelta[]>(() => {
    const out: ImpactDelta[] = [];
    if (current.items.length === 0) {
      out.push({ genreId: parentGenreId, amountYen: Math.abs(current.amountYen) });
    } else {
      for (const item of current.items) {
        const g =
          (item.lineId !== undefined ? genreByLineId.get(item.lineId) : null) ?? parentGenreId;
        out.push({ genreId: g, amountYen: Math.abs(item.amountYen) });
      }
    }
    return out;
  }, [current.items, current.amountYen, genreByLineId, parentGenreId]);
  const impact = useMemo(
    () =>
      goal === null
        ? null
        : goalImpact(goal.snapshot, { occurredOn, today: goal.today, kind, deltas }),
    [goal, occurredOn, kind, deltas],
  );
  const choice = useMemo(
    () =>
      goal === null
        ? { needed: false, reason: null }
        : needsKindChoice(goal.snapshot, { occurredOn, today: goal.today, deltas }),
    [goal, occurredOn, deltas],
  );
  const mustChoose = choice.needed && !kindChosen;

  const save = () => {
    if (mustChoose) return;
    if (draft === null && current.items.length === 0 && current.amountYen === 0) return;
    const plan = buildReceiptSavePlan({
      parsed: current,
      accountId,
      parentGenreId,
      genreByLineId,
      kind,
      sourceRef: crypto.randomUUID(),
    });
    const corrections = (draft?.lines ?? [])
      .filter((l) => l.kind === 'item')
      .flatMap((l) => {
        const now = genreByLineId.get(l.id) ?? null;
        return now !== null && now !== (initialGenreMap.get(l.id) ?? null)
          ? [{ itemName: l.name, genreId: now }]
          : [];
      });
    onSave({
      plan,
      corrections,
      storeName: store,
      imageBase64: job.imageBase64,
      goalMessage:
        goal !== null && impact !== null
          ? goalToastMessage({
              label: `${store} ${formatYen(paidYen, { sign: 'never' })}`,
              impact,
              goal: goal.snapshot,
              today: goal.today,
            })
          : null,
    });
  };

  const field = 'mt-1 min-h-11 w-full rounded-xl px-3 text-sm';
  const fieldStyle = {
    background: 'var(--plane)',
    color: 'var(--ink)',
    border: '1px solid transparent',
  };

  return (
    <section
      aria-label={`${store}のレシート`}
      className="glass overflow-hidden rounded-[28px]"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      {/* 上半分:画像(ズーム可)。品目をタップすると該当行をハイライトする。 */}
      <ZoomableImage
        src={job.previewUrl}
        alt="撮影したレシート"
        highlightRatio={selectedLine?.yRatio ?? null}
        className="h-[38vh] min-h-56"
      />

      {/* 下半分:読み取り結果 */}
      <div className="space-y-5 p-5 pb-3">
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
              店名{original.branchName ? `(${original.branchName})` : ''}
            </span>
            <input
              value={store}
              onChange={(e) => setStore(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl px-3 text-lg font-semibold"
              style={{ ...fieldStyle, ...underline(lowStore) }}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
                日付
              </span>
              <input
                type="date"
                value={occurredOn}
                onChange={(e) => setOccurredOn(e.target.value)}
                className={field}
                style={{ ...fieldStyle, ...underline(lowDate) }}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
                支払額(円)
              </span>
              <input
                inputMode="numeric"
                value={String(paidYen)}
                onChange={(e) => {
                  const yen = Number(e.target.value.replace(/[^0-9]/g, '') || '0');
                  if (draft !== null) update((d) => ({ ...d, paidYen: yen }));
                }}
                disabled={draft === null}
                className="tabular mt-1 min-h-11 w-full rounded-xl px-3 text-2xl font-semibold"
                style={{ ...fieldStyle, ...underline(lowTotal) }}
              />
            </label>
          </div>
        </div>

        {duplicates > 0 ? (
          <p
            role="alert"
            className="rounded-xl px-3 py-2 text-xs leading-relaxed"
            style={{
              background: 'var(--attention-track, var(--plane))',
              color: 'var(--ink)',
              border: '1px solid var(--attention)',
            }}
          >
            ⚠ 同じ店・同じ日・近い金額の記録が {duplicates}{' '}
            件あります。二重登録でないか確認してください。
          </p>
        ) : null}

        {draft !== null ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
                品目
                <span
                  className="ml-1 text-xs font-normal"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  {draft.lines.filter((l) => l.kind === 'item').length}点
                </span>
              </h3>
              <div
                role="radiogroup"
                aria-label="価格の表示"
                className="flex gap-1 rounded-full p-1 text-xs"
                style={{ background: 'var(--plane)' }}
              >
                {(
                  [
                    ['tax_included', '内税(税込表示)'],
                    ['tax_excluded', '外税(税抜表示)'],
                  ] as [PriceBasis, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={draft.priceBasis === value}
                    onClick={() => update((d) => ({ ...d, priceBasis: value }))}
                    className="glass min-h-11 rounded-full px-3 font-semibold"
                    style={{
                      background: draft.priceBasis === value ? 'var(--surface)' : 'transparent',
                      color: draft.priceBasis === value ? 'var(--ink)' : 'var(--ink-secondary)',
                      boxShadow: draft.priceBasis === value ? 'var(--card-shadow)' : 'none',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 品目は税率でグループ化。タップで選択(複数可)→ 下のチップで一括変更 */}
            {groups.map((g) => {
              const total = g.lines
                .filter((l) => l.kind === 'item')
                .reduce((a, l) => a + l.amountYen, 0);
              return (
                <div key={String(g.rate)}>
                  <div
                    className="flex items-baseline justify-between px-1 text-xs"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    <span className="font-semibold">{RATE_LABEL[String(g.rate)]}</span>
                    <span className="tabular font-semibold">{formatYen(total)}</span>
                  </div>
                  <ul className="mt-2 space-y-2">
                    {g.lines.map((l) => (
                      <LineRow
                        key={l.id}
                        line={l}
                        genreLabel={
                          l.kind === 'discount'
                            ? null
                            : (genreName.get(genreByLineId.get(l.id) ?? '') ?? '未分類')
                        }
                        selected={selected.has(l.id)}
                        editing={editing === l.id}
                        onToggle={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(l.id)) next.delete(l.id);
                            else next.add(l.id);
                            return next;
                          })
                        }
                        onEdit={() => setEditing(editing === l.id ? null : l.id)}
                        onChange={(patch) => updateLine(l.id, patch)}
                        onRemove={() => {
                          update((d) => ({ ...d, lines: d.lines.filter((x) => x.id !== l.id) }));
                          setSelected((prev) => {
                            const next = new Set(prev);
                            next.delete(l.id);
                            return next;
                          });
                        }}
                        fieldStyle={fieldStyle}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}

            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="ポイント払い(円)"
                value={draft.pointsYen}
                onChange={(v) => update((d) => ({ ...d, pointsYen: v }))}
                style={fieldStyle}
              />
              <NumberField
                label="クーポン(円)"
                value={draft.couponYen}
                onChange={(v) => update((d) => ({ ...d, couponYen: v }))}
                style={fieldStyle}
              />
            </div>

            {/* ジャンル:選んだ品目を、チップで一括変更 */}
            <div className="rounded-2xl p-3" style={{ background: 'var(--plane)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
                {selected.size > 0
                  ? `${selected.size}件を選択中 ─ ジャンルをタップで一括変更`
                  : '品目をタップして選ぶと、ジャンルを一括で変えられます'}
              </p>
              <div
                className="mt-2 flex gap-2 overflow-x-auto pb-1"
                role="group"
                aria-label="ジャンル"
              >
                {genres.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    disabled={selected.size === 0}
                    onClick={() => setGenreFor(selected, g.id)}
                    className="glass min-h-11 shrink-0 rounded-full px-4 text-xs font-semibold disabled:opacity-40"
                    style={{
                      background: 'var(--surface)',
                      color: 'var(--accent)',
                      boxShadow: 'var(--card-shadow)',
                    }}
                  >
                    {g.name}
                  </button>
                ))}
                {selected.size > 0 ? (
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="min-h-11 shrink-0 rounded-full px-3 py-2 text-xs"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    選択を解除
                  </button>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                update((d) => ({
                  ...d,
                  lines: [
                    ...d.lines,
                    {
                      id: `manual-${d.lines.length}-${Date.now()}`,
                      name: '品目',
                      amountYen: 0,
                      kind: 'item',
                      taxRate: null,
                      genreId: null,
                      confidence: 1,
                      yRatio: null,
                    },
                  ],
                }))
              }
              className="min-h-11 w-full rounded-2xl text-sm font-semibold"
              style={{ color: 'var(--accent)', border: '1.5px dashed var(--hairline)' }}
            >
              ＋ 品目を追加
            </button>
          </>
        ) : (
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            品目は読み取れませんでした。金額と店名だけで保存できます。
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="col-span-2 block">
            <span className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
              明細のジャンル
            </span>
            <select
              value={parentGenreId ?? ''}
              onChange={(e) => setParentGenreId(e.target.value || null)}
              className={field}
              style={fieldStyle}
            >
              <option value="">未分類</option>
              {genres.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div role="radiogroup" aria-label="目標の扱い" className="space-y-1">
          <span className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
            目標の扱い
          </span>
          <div className="flex gap-1 rounded-full p-1" style={{ background: 'var(--plane)' }}>
            {(
              [
                ['normal', '目標の予算に含める'],
                ['special', '特別費として別枠'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={kind === value}
                onClick={() => {
                  setKind(value);
                  setKindChosen(true);
                }}
                className="glass min-h-11 flex-1 rounded-full px-2 text-xs font-semibold"
                style={{
                  background: kind === value ? 'var(--surface)' : 'transparent',
                  color: kind === value ? 'var(--ink)' : 'var(--ink-secondary)',
                  boxShadow: kind === value ? 'var(--card-shadow)' : 'none',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {choice.needed ? (
          <div
            role="group"
            aria-label="目標の扱い"
            className="rounded-xl p-3"
            style={{
              background: 'var(--attention-track)',
              border: '1px solid var(--state-caution)',
            }}
          >
            <p className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
              {choice.reason === 'scheduled'
                ? '今日より先の日付です。'
                : 'このジャンルの予算の半分以上になる支払いです。'}
              目標の扱いを選んでください
            </p>
            <div className="mt-2 flex gap-2">
              {(
                [
                  ['normal', '目標の予算に含める'],
                  ['special', '特別費として別枠'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={kindChosen && kind === value}
                  onClick={() => {
                    setKind(value);
                    setKindChosen(true);
                  }}
                  className="min-h-11 flex-1 rounded-full px-3 py-2 text-xs font-semibold"
                  style={{
                    background: kindChosen && kind === value ? 'var(--accent)' : 'var(--surface)',
                    color:
                      kindChosen && kind === value ? 'var(--on-accent)' : 'var(--ink-secondary)',
                    border: '1px solid var(--hairline)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {impact !== null && goal !== null ? <GoalImpactView impact={impact} /> : null}
      </div>

      {/* 照合バー(下部に固定):品目合計 + 税 − 値引き − ポイント = 支払額 */}
      <div
        className="sticky bottom-0 space-y-2 border-t p-4"
        style={{
          background: 'var(--surface-raised)',
          borderColor: 'var(--hairline)',
          boxShadow: '0 -12px 24px -20px rgba(0, 0, 0, 0.35)',
        }}
      >
        {reconcile !== null ? (
          <ReconcileBar result={reconcile} onFix={(fix) => update((d) => applyFix(d, fix))} />
        ) : null}
        {savedLabel !== null ? (
          <p
            role="status"
            className="text-center text-sm font-semibold"
            style={{ color: 'var(--income)' }}
          >
            ✓ {savedLabel}
          </p>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onDiscard}
              className="min-h-12 rounded-full px-5 text-sm font-semibold"
              style={{ color: 'var(--ink-secondary)', background: 'var(--plane)' }}
            >
              破棄
            </button>
            <button
              type="button"
              onClick={save}
              disabled={
                saving || !accountId || mustChoose || (draft !== null && draft.paidYen <= 0)
              }
              className="glass min-h-12 flex-1 rounded-full text-base font-semibold disabled:opacity-40"
              style={{
                background: 'var(--action)',
                color: 'var(--on-action)',
                boxShadow: 'var(--card-shadow)',
              }}
            >
              {saving
                ? '保存しています…'
                : status === 'mismatch'
                  ? '差額を残して保存(要確認に入ります)'
                  : '保存する'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function LineRow({
  line,
  genreLabel,
  selected,
  editing,
  onToggle,
  onEdit,
  onChange,
  onRemove,
  fieldStyle,
}: {
  line: ReceiptLine;
  genreLabel: string | null;
  selected: boolean;
  editing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onChange: (patch: Partial<ReceiptLine>) => void;
  onRemove: () => void;
  fieldStyle: React.CSSProperties;
}) {
  const low = line.confidence < LOW_CONFIDENCE;
  const isDiscount = line.kind === 'discount';
  return (
    <li
      className="rounded-2xl"
      style={{
        background: selected ? 'var(--accent-track)' : 'var(--plane)',
        boxShadow: selected ? 'inset 0 0 0 2px var(--accent)' : 'none',
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-pressed={selected}
          onClick={onToggle}
          className="min-h-11 flex min-w-0 flex-1 items-baseline justify-between gap-2 text-left"
        >
          <span className="min-w-0">
            <span
              className="block truncate text-sm"
              style={{ color: 'var(--ink)', ...underline(low) }}
            >
              {selected ? '✓ ' : ''}
              {isDiscount ? '値引き ' : ''}
              {line.name}
            </span>
            {genreLabel !== null ? (
              <span
                className="mt-1 inline-block rounded-full px-2 text-xs font-semibold"
                style={{
                  background: 'var(--surface)',
                  color: genreLabel === '未分類' ? 'var(--attention)' : 'var(--ink-secondary)',
                }}
              >
                {genreLabel}
              </span>
            ) : null}
          </span>
          <span className="tabular shrink-0 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            {isDiscount ? '−' : ''}
            {formatYen(line.amountYen)}
          </span>
        </button>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`${line.name}を編集`}
          aria-expanded={editing}
          className="min-h-11 shrink-0 text-xs font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          編集
        </button>
      </div>
      {editing ? (
        <div className="grid grid-cols-6 gap-2 px-3 pb-3">
          <input
            aria-label="品名"
            value={line.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="col-span-6 rounded-lg px-2 py-2 text-sm"
            style={fieldStyle}
          />
          <input
            aria-label="金額"
            inputMode="numeric"
            value={String(line.amountYen)}
            onChange={(e) =>
              onChange({ amountYen: Number(e.target.value.replace(/[^0-9]/g, '') || '0') })
            }
            className="tabular col-span-2 rounded-lg px-2 py-2 text-sm"
            style={fieldStyle}
          />
          <select
            aria-label="税率"
            value={line.taxRate === null ? '' : String(line.taxRate)}
            onChange={(e) =>
              onChange({
                taxRate: e.target.value === '' ? null : (Number(e.target.value) as TaxRate),
              })
            }
            className="col-span-2 rounded-lg px-1 py-2 text-sm"
            style={fieldStyle}
          >
            <option value="">税率不明</option>
            <option value="8">8%</option>
            <option value="10">10%</option>
            <option value="0">非課税</option>
          </select>
          <select
            aria-label="種類"
            value={line.kind}
            onChange={(e) => onChange({ kind: e.target.value as ReceiptLine['kind'] })}
            className="col-span-2 rounded-lg px-1 py-2 text-sm"
            style={fieldStyle}
          >
            <option value="item">品目</option>
            <option value="discount">値引き</option>
          </select>
          <button
            type="button"
            onClick={onRemove}
            className="min-h-11 col-span-6 text-left text-xs"
            style={{ color: 'var(--ink-muted)' }}
          >
            この行を削除
          </button>
        </div>
      ) : null}
    </li>
  );
}

function NumberField({
  label,
  value,
  onChange,
  style,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  style: React.CSSProperties;
}) {
  return (
    <label className="block">
      <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </span>
      <input
        inputMode="numeric"
        value={String(value)}
        onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9]/g, '') || '0'))}
        className="tabular w-full rounded-lg px-2 py-2 text-sm"
        style={style}
      />
    </label>
  );
}

const FIX_LABEL: Record<ReconcileSuggestion['type'], string> = {
  adjust_rounding: '端数として調整',
  add_discount: '値引き行を追加',
  check_missing_line: '行の読み落とし分を追加',
};

/** 照合バー:品目合計 + 税 − 値引き − ポイント = 支払額。不一致なら差額と修正候補。 */
function ReconcileBar({
  result,
  onFix,
}: {
  result: ReturnType<typeof reconcileReceipt>;
  onFix: (fix: ReconcileSuggestion) => void;
}) {
  const ok = result.status === 'ok';
  const discounts = result.discountYen + result.pointsYen + result.couponYen;
  return (
    <div role="status" aria-live="polite">
      <p className="tabular text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        品目 {formatYen(result.itemsYen)} + 税 {formatYen(result.taxYen)} − 値引き・ポイント{' '}
        {formatYen(discounts)} = {formatYen(result.expectedPaidYen)}
        <span style={{ color: 'var(--ink-muted)' }}> / 支払 {formatYen(result.paidYen)}</span>
      </p>
      {ok ? (
        <p className="text-xs font-semibold" style={{ color: 'var(--income)' }}>
          ✓ 一致しています
          {result.absorbedYen !== 0 ? `(${formatYen(result.absorbedYen)}は端数として調整)` : ''}
        </p>
      ) : (
        <div>
          <p className="text-xs font-semibold" style={{ color: 'var(--attention)' }}>
            ⚠ 差額 {result.diffYen > 0 ? '+' : '−'}
            {formatYen(Math.abs(result.diffYen))}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {result.suggestions.map((s) => (
              <button
                key={s.type}
                type="button"
                onClick={() => onFix(s)}
                className="min-h-11 rounded-full px-3 py-1 text-xs font-semibold"
                style={{
                  background: s.recommended ? 'var(--accent)' : 'var(--plane)',
                  color: s.recommended ? 'var(--on-accent)' : 'var(--ink-secondary)',
                }}
              >
                {FIX_LABEL[s.type]}
                {s.recommended ? '(おすすめ)' : ''}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const IMPACT_REASON: Record<string, string> = {
  special: '特別費として別枠にするので、目標のペースには含めません。',
  scheduled: '今日より先の予定なので、目標のペースには含めません。',
  outside_period: '目標の期間の外なので、目標には含めません。',
  no_target: '目標のあるジャンルではないので、目標には含めません。',
};

/** 保存前 → 保存後の残り予算を、影響のあるジャンルごとにミニバーで見せる。 */
function GoalImpactView({ impact }: { impact: ReturnType<typeof goalImpact> }) {
  if (impact.rows.length === 0 && impact.counts) return null;
  return (
    <div
      className="rounded-xl p-3"
      style={{ background: 'var(--plane)' }}
      role="group"
      aria-label="目標への影響"
    >
      <p className="text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>
        目標への影響(保存前 → 保存後の残り予算)
      </p>
      {!impact.counts && impact.reason !== 'included' ? (
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {IMPACT_REASON[impact.reason]}
        </p>
      ) : null}
      <ul className="mt-2 space-y-3">
        {impact.rows.map((r) => {
          const before = Math.min(Math.max(r.beforeSpentYen / r.targetYen, 0), 1);
          const after = Math.min(Math.max(r.afterSpentYen / r.targetYen, 0), 1);
          return (
            <li
              key={r.genreId}
              aria-label={`${r.genreName}、残り${formatYen(r.beforeRemainingYen)}から${formatYen(r.afterRemainingYen)}へ、${STATE_LABEL[r.state]}`}
            >
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span style={{ color: 'var(--ink)' }}>{r.genreName}</span>
                <span className="tabular" style={{ color: 'var(--ink-secondary)' }}>
                  {formatYen(r.beforeRemainingYen)} → {formatYen(r.afterRemainingYen)}
                  <span className="ml-2 font-semibold" style={{ color: STATE_COLOR[r.state] }}>
                    <span aria-hidden>{STATE_ICON[r.state]} </span>
                    {STATE_LABEL[r.state]}
                  </span>
                </span>
              </div>
              <div
                aria-hidden
                className="relative mt-1 h-2 overflow-hidden rounded-full"
                style={{ background: STATE_TRACK[r.state] }}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${after * 100}%`, background: STATE_COLOR[r.state] }}
                />
                <span
                  className="absolute inset-y-0 w-1"
                  style={{
                    left: `calc(${before * 100}% - 1px)`,
                    background: 'var(--ink)',
                    opacity: 0.6,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
        縦線=保存前の使用額、色のバー=保存後
      </p>
    </div>
  );
}
