'use client';

import { useEffect, useMemo, useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Yen } from '@/components/ui/money';
import { Segmented } from '@/components/ui/segmented';
import {
  buildItemDetail,
  flattenRows,
  searchLines,
  sparklinePoints,
  stickyHeaderFor,
  type LineSort,
  type ListRow,
} from '@/features/category/list';
import {
  actualSpentYen,
  aggregateItems,
  aggregateStores,
  collectItemOccurrences,
  NO_ITEM_KEY,
  type CategoryLine,
  type ItemAggregate,
  type StoreAggregate,
} from '@/features/category/model';
import { formatDateJa, weekdayOf } from '@/lib/date';
import { hapticFor } from '@/lib/haptics';
import { DragSelect } from '@/lib/drag-select';
import { ScrollMemory } from '@/lib/virtual';
import { CategoryTransactionRow } from './transaction-row';
import { VirtualList } from './virtual-list';

export type CategoryTab = 'tx' | 'items' | 'stores';

/** 上部に固定される小さなヘッダーの高さ(44pt)と、その下の取引/品目/店の帯の高さ。 */
const COMPACT_HEADER_PX = 44;
const TABS_STICKY_PX = 60;

const TABS: { value: CategoryTab; label: string }[] = [
  { value: 'tx', label: '取引' },
  { value: 'items', label: '品目' },
  { value: 'stores', label: '店' },
];

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 取引 / 品目 / 店 の3つの見方。切り替えるときは選択の触覚を返し、各タブのスクロール位置は
 * 個別に覚えておく。一覧は仮想化(見えている行だけを描画)して、1万件でも滑らかにスクロールする。
 * どのタブの合計も、カテゴリの使った額(家計簿のジャンル内訳)と一致する。
 */
export function CategoryTabs({
  genreKey,
  lines,
  historyLines,
  tab,
  onTab,
  focusedLines,
  focusLabel,
  onClearFocus,
  onOpenLine,
  onFocusStore,
  quickDestination,
  onQuickMove,
  onMoveMenu,
  ghostLines,
  selectMode,
  selectedIds,
  onSelectedChange,
  predictionsFor,
  onPredict,
}: {
  genreKey: string;
  /** 選んだ月の行(実績・予定)。 */
  lines: readonly CategoryLine[];
  /** 履歴を含む行(品目の価格の推移に使う)。 */
  historyLines: readonly CategoryLine[];
  tab: CategoryTab;
  onTab: (tab: CategoryTab) => void;
  /** 気づき・グラフの棒で絞り込んだ行(取引タブだけに効く)。null なら絞り込まない。 */
  focusedLines: readonly CategoryLine[] | null;
  focusLabel: string | null;
  onClearFocus: () => void;
  onOpenLine: (line: CategoryLine) => void;
  onFocusStore: (store: StoreAggregate) => void;
  /** 右スワイプの移動先(最もよく使う移動先)。 */
  quickDestination: { id: string; name: string } | null;
  onQuickMove: (line: CategoryLine) => void;
  onMoveMenu: (line: CategoryLine) => void;
  /** 別のカテゴリへ移って消えていく途中の行(250ms の間だけ一覧に残す)。 */
  ghostLines: readonly CategoryLine[];
  /** 複数選択のモード(なぞって選べる)。 */
  selectMode: boolean;
  selectedIds: ReadonlySet<string>;
  onSelectedChange: (ids: ReadonlySet<string>) => void;
  /** 未分類の行の予測(上位3件)。 */
  predictionsFor?: (line: CategoryLine) => readonly { genreId: string; genreName: string }[];
  onPredict?: (line: CategoryLine, genreId: string) => void;
}) {
  const [sort, setSort] = useState<LineSort>('newest');
  const [query, setQuery] = useState('');
  const [memory] = useState(() => new ScrollMemory<CategoryTab>());
  const [itemKey, setItemKey] = useState<string | null>(null);
  // なぞって複数選択(写真アプリと同じ操作)。
  const [drag] = useState(() => new DragSelect());
  const [dragging, setDragging] = useState(false);

  const items = useMemo(() => aggregateItems(lines, genreKey), [lines, genreKey]);
  const stores = useMemo(() => aggregateStores(lines), [lines]);
  const txLines = useMemo(
    () => searchLines(focusedLines ?? lines, query),
    [focusedLines, lines, query],
  );
  const ghostIds = useMemo(() => new Set(ghostLines.map((g) => g.txId)), [ghostLines]);
  // 消えていく途中の行も一覧には残す(合計・件数には数えない)。
  const rows = useMemo(
    () =>
      flattenRows(
        [...txLines, ...ghostLines.filter((g) => !txLines.some((l) => l.txId === g.txId))],
        sort,
      ),
    [txLines, ghostLines, sort],
  );

  const [firstVisible, setFirstVisible] = useState(0);
  const sticky = sort === 'newest' ? stickyHeaderFor(rows, firstVisible) : null;

  const select = (next: CategoryTab) => {
    if (next === tab) return;
    memory.save(tab, window.scrollY);
    hapticFor('tabChange');
    onTab(next);
    // そのタブで最後に見ていた位置へ戻す(初めて開くなら、いまの位置のまま)。
    const y = memory.get(next);
    if (y !== null) window.requestAnimationFrame(() => window.scrollTo(0, y));
  };

  const lineOrder = useMemo(
    () => rows.flatMap((r) => (r.kind === 'line' ? [r.line.txId] : [])),
    [rows],
  );

  // なぞっている間は、指の下の行を選ぶ(画面の端に近づいたら、自動でスクロールする)。
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-row-id]');
      const id = el?.getAttribute('data-row-id');
      if (id) {
        const next = drag.visit(id);
        if (next) onSelectedChange(next);
      }
      if (e.clientY < 120) window.scrollBy(0, -16);
      else if (e.clientY > window.innerHeight - 180) window.scrollBy(0, 16);
    };
    const up = () => {
      drag.end();
      setDragging(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging, drag, onSelectedChange]);

  const startDrag = (id: string) => {
    onSelectedChange(drag.begin(lineOrder, selectedIds, id));
    hapticFor('filterChange');
    setDragging(true);
  };

  const txTotal = actualSpentYen(txLines);
  const itemsTotal = items.reduce((a, i) => a + i.totalYen, 0);
  const storesTotal = stores.reduce((a, s) => a + s.totalYen, 0);
  const openItem = itemKey === null ? null : (items.find((i) => i.key === itemKey) ?? null);

  return (
    <section id="category-tabs" aria-label="取引・品目・店" className="scroll-mt-16 space-y-3">
      {/* 取引 / 品目 / 店:スクロールすると、上部に固定されたヘッダーの直下に留まる */}
      <div
        className="sticky z-20 -mx-4 px-4 py-1"
        style={{
          top: `calc(var(--sticky-top) + ${COMPACT_HEADER_PX}px)`,
          background: 'var(--plane)',
        }}
      >
        <Segmented
          value={tab}
          options={TABS}
          onChange={(v) => select(v)}
          label="見方の切り替え"
          className="flex w-full [&>button]:flex-1"
        />
      </div>

      {tab === 'tx' ? (
        <>
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="このカテゴリ内を検索"
              aria-label="カテゴリ内を検索"
              className="min-h-11 min-w-0 flex-1 rounded-xl px-3 text-sm"
              style={{
                background: 'var(--surface-raised)',
                color: 'var(--ink)',
                border: '1px solid var(--hairline)',
              }}
            />
            <div role="group" aria-label="並び替え" className="flex gap-1">
              {(
                [
                  ['newest', '日付順'],
                  ['amount', '金額順'],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={sort === v}
                  onClick={() => {
                    hapticFor('filterChange');
                    setSort(v);
                  }}
                  className="min-h-11 rounded-full px-3 text-xs font-semibold"
                  style={{
                    background: sort === v ? 'var(--accent)' : 'transparent',
                    color: sort === v ? 'var(--on-accent)' : 'var(--ink-secondary)',
                    border: `1px solid ${sort === v ? 'transparent' : 'var(--hairline)'}`,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {focusLabel !== null ? (
            <button
              type="button"
              onClick={onClearFocus}
              aria-label={`${focusLabel}の絞り込みを解除`}
              className="tabular min-h-11 inline-flex items-center gap-2 rounded-full px-4 text-xs font-semibold"
              style={{
                background: 'var(--surface-raised)',
                color: 'var(--ink)',
                border: '1px solid var(--hairline)',
              }}
            >
              {focusLabel}で絞り込み中<span aria-hidden>×</span>
            </button>
          ) : null}

          <TotalLine
            label="合計"
            yen={txTotal}
            count={txLines.filter((l) => l.status === 'actual').length}
            unit="件"
          />

          {rows.length === 0 ? (
            <EmptyMessage>
              {query !== '' || focusedLines !== null
                ? 'この条件に一致する取引はありません。'
                : 'この月の取引はありません。'}
            </EmptyMessage>
          ) : (
            <div
              className="relative rounded-2xl"
              style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
            >
              {sticky && sticky.kind === 'header' && firstVisible > 0 ? (
                <div
                  aria-hidden
                  className="sticky z-10 rounded-t-2xl"
                  style={{
                    top: `calc(var(--sticky-top) + ${COMPACT_HEADER_PX + TABS_STICKY_PX}px)`,
                    background: 'var(--surface)',
                  }}
                >
                  <DayHeader row={sticky} />
                </div>
              ) : null}
              <VirtualList
                items={rows}
                estimate={72}
                label="取引"
                getKey={(r) => r.key}
                onWindow={setFirstVisible}
                render={(r) =>
                  r.kind === 'header' ? (
                    <DayHeader row={r} />
                  ) : (
                    <CategoryTransactionRow
                      line={r.line}
                      onOpen={onOpenLine}
                      quickDestination={quickDestination}
                      onQuickMove={onQuickMove}
                      onMoveMenu={onMoveMenu}
                      leaving={ghostIds.has(r.line.txId)}
                      selectMode={selectMode}
                      selected={selectedIds.has(r.line.txId)}
                      onSelectStart={startDrag}
                      {...(predictionsFor ? { predictions: predictionsFor(r.line) } : {})}
                      {...(onPredict ? { onPredict } : {})}
                    />
                  )
                }
              />
            </div>
          )}
        </>
      ) : null}

      {tab === 'items' ? (
        <>
          <TotalLine label="合計" yen={itemsTotal} count={items.length} unit="品目" />
          {items.length === 0 ? (
            <EmptyMessage>この月の品目はありません。</EmptyMessage>
          ) : (
            <div
              className="rounded-2xl"
              style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
            >
              <VirtualList
                items={items}
                estimate={64}
                label="品目"
                getKey={(i) => i.key}
                render={(i) => <ItemRow item={i} onOpen={() => setItemKey(i.key)} />}
              />
            </div>
          )}
        </>
      ) : null}

      {tab === 'stores' ? (
        <>
          <TotalLine label="合計" yen={storesTotal} count={stores.length} unit="店" />
          {stores.length === 0 ? (
            <EmptyMessage>この月の店はありません。</EmptyMessage>
          ) : (
            <div
              className="rounded-2xl"
              style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
            >
              <VirtualList
                items={stores}
                estimate={72}
                label="店"
                getKey={(s) => s.key}
                render={(s) => <StoreRow store={s} onOpen={() => onFocusStore(s)} />}
              />
            </div>
          )}
        </>
      ) : null}

      <ItemDetailSheet
        item={openItem}
        historyLines={historyLines}
        genreKey={genreKey}
        onClose={() => setItemKey(null)}
        onOpenLine={(l) => {
          setItemKey(null);
          onOpenLine(l);
        }}
      />
    </section>
  );
}

function TotalLine({
  label,
  yen,
  count,
  unit,
}: {
  label: string;
  yen: number;
  count: number;
  unit: string;
}) {
  return (
    <p
      className="tabular flex items-baseline justify-between text-sm"
      style={{ color: 'var(--ink-secondary)' }}
    >
      <span>
        {count}
        {unit}
      </span>
      <span aria-label={`${label}${yen.toLocaleString('ja-JP')}円`}>
        {label} <Yen value={yen} className="font-semibold" />
      </span>
    </p>
  );
}

function EmptyMessage({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 py-6 text-center text-sm" style={{ color: 'var(--ink-secondary)' }}>
      {children}
    </p>
  );
}

function DayHeader({ row }: { row: Extract<ListRow, { kind: 'header' }> }) {
  return (
    <div
      className="tabular flex items-baseline justify-between px-4 py-2 text-xs font-semibold"
      style={{ color: 'var(--ink-secondary)' }}
    >
      <span>
        {formatDateJa(row.date)}({WEEKDAYS[weekdayOf(row.date)]})
      </span>
      {row.scheduledOnly ? (
        <span>予定</span>
      ) : (
        <span aria-label={`この日の合計${Math.abs(row.spentYen).toLocaleString('ja-JP')}円`}>
          {row.spentYen < 0 ? '返金 ' : ''}
          <Yen value={row.spentYen} />
        </span>
      )}
    </div>
  );
}

function ItemRow({ item, onOpen }: { item: ItemAggregate; onOpen: () => void }) {
  const noItem = item.key === NO_ITEM_KEY;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={noItem}
      aria-label={`${item.name}、${item.count}回、合計${item.totalYen.toLocaleString('ja-JP')}円、平均単価${item.averageYen.toLocaleString('ja-JP')}円`}
      className="min-h-14 flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-100"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug break-words" style={{ color: 'var(--ink)' }}>
          {item.name}
          <span className="tabular ml-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            ×{item.count}
          </span>
        </p>
        <p className="tabular mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          平均単価 {item.averageYen.toLocaleString('ja-JP')}円
        </p>
      </div>
      <Yen value={item.totalYen} className="shrink-0 text-sm font-semibold" />
    </button>
  );
}

function StoreRow({ store, onOpen }: { store: StoreAggregate; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${store.label}、合計${store.totalYen.toLocaleString('ja-JP')}円、${store.count}回、1回あたり${store.averageYen.toLocaleString('ja-JP')}円、最後は${formatDateJa(store.lastOn)}`}
      className="min-h-14 flex w-full items-center gap-3 px-4 py-3 text-left"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug break-words" style={{ color: 'var(--ink)' }}>
          {store.label}
        </p>
        <p className="tabular mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {store.count}回 ・ 1回あたり {store.averageYen.toLocaleString('ja-JP')}円 ・ 最後{' '}
          {formatDateJa(store.lastOn)}
        </p>
      </div>
      <Yen value={store.totalYen} className="shrink-0 text-sm font-semibold" />
    </button>
  );
}

/**
 * 品目の詳細:単価の推移(小さな折れ線)、店ごとの単価の比較(最安の店に印)、この品目を含む取引。
 * 推移は履歴(選んだ月までの6か月)の購入から作る。
 */
function ItemDetailSheet({
  item,
  historyLines,
  genreKey,
  onClose,
  onOpenLine,
}: {
  item: ItemAggregate | null;
  historyLines: readonly CategoryLine[];
  genreKey: string;
  onClose: () => void;
  onOpenLine: (line: CategoryLine) => void;
}) {
  const detail = useMemo(() => {
    if (item === null) return null;
    const occ =
      collectItemOccurrences(historyLines, genreKey).byKey.get(item.key)?.occurrences ?? [];
    return buildItemDetail(item.name, occ);
  }, [item, historyLines, genreKey]);
  const lines = useMemo(
    () => (detail ? historyLines.filter((l) => detail.txIds.includes(l.txId)) : []),
    [detail, historyLines],
  );

  return (
    <BottomSheet open={item !== null} onClose={onClose} role="dialog">
      {detail ? <ItemDetailBody detail={detail} lines={lines} onOpenLine={onOpenLine} /> : null}
    </BottomSheet>
  );
}

/** 品目の詳細の中身(シートの中に出す)。 */
export function ItemDetailBody({
  detail,
  lines,
  onOpenLine,
}: {
  detail: ReturnType<typeof buildItemDetail>;
  lines: readonly CategoryLine[];
  onOpenLine: (line: CategoryLine) => void;
}) {
  return (
    <div className="space-y-4 px-3 pb-3">
      <div>
        <h2 className="text-base font-semibold break-words" style={{ color: 'var(--ink)' }}>
          {detail.name}
        </h2>
        <p className="tabular mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {detail.count}回 ・ 平均単価 {detail.averageYen.toLocaleString('ja-JP')}円
        </p>
      </div>

      <div>
        <p className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
          単価の推移
        </p>
        <PriceTrend points={detail.points} />
      </div>

      {detail.stores.length > 0 ? (
        <div>
          <p className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
            店ごとの単価
          </p>
          <ul className="mt-1 space-y-1">
            {detail.stores.map((s) => (
              <li
                key={s.key}
                className="tabular flex min-h-11 items-center justify-between gap-3 text-sm"
              >
                <span className="min-w-0 break-words" style={{ color: 'var(--ink)' }}>
                  {s.label}
                  {s.cheapest ? (
                    <span
                      className="ml-2 rounded-full px-2 py-1 text-xs font-semibold"
                      style={{ background: 'var(--income-track)', color: 'var(--income)' }}
                    >
                      <span aria-hidden>◎ </span>最安
                    </span>
                  ) : null}
                </span>
                <span style={{ color: 'var(--ink)' }}>
                  {s.averageYen.toLocaleString('ja-JP')}円
                  <span className="ml-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
                    ({s.count}回)
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
          この品目を含む取引
        </p>
        <ul className="divider-list mt-1">
          {lines.map((l) => (
            <li key={l.txId}>
              <CategoryTransactionRow line={l} onOpen={onOpenLine} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** 単価の推移の小さな折れ線(SVG)。点が1つだけなら点だけ。読み上げは最初と最後の値。 */
function PriceTrend({ points }: { points: ReturnType<typeof buildItemDetail>['points'] }) {
  const W = 280;
  const H = 64;
  const pts = sparklinePoints(points, W, H);
  if (pts.length === 0) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const label = `単価の推移:${formatDateJa(first.date)}の${first.unitYen.toLocaleString('ja-JP')}円から、${formatDateJa(last.date)}の${last.unitYen.toLocaleString('ja-JP')}円`;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${W} ${H}`}
      className="mt-1 h-16 w-full"
      preserveAspectRatio="none"
    >
      {pts.length > 1 ? (
        <polyline
          points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="var(--ink-secondary)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 4 : 2.5} fill="var(--ink)" />
      ))}
    </svg>
  );
}
