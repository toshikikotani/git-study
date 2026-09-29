'use client';

import { GenreBadge } from '@/components/ui/genre-badge';
import {
  STATE_COLOR,
  STATE_ICON,
  STATE_LABEL,
  STATE_TRACK,
  budgetSpokenLabel,
  budgetState,
} from '@/domain/budget-state';
import { formatYen } from '@/domain/money';

/**
 * ジャンル1行(家計簿のジャンル内訳と目標画面で共通)。
 *
 *   予算あり:実績バー + 今日時点の理想ラインの目印 + 状態色(余裕=青/注意=黄/超過=赤)
 *   予算なし:グレーのバー(全体に対する大きさ)。状態の文言は出さない
 *
 * 色だけに頼らず、状態はアイコンとラベルでも示す。VoiceOver には
 * 「外食、7,900円のうち5,000円使用、残り2,900円」と読み上げる。
 */
export function GenreBudgetRow({
  name,
  spentYen,
  budgetYen,
  idealYen = null,
  maxYen,
  selected = false,
  onClick,
  children,
}: {
  name: string;
  spentYen: number;
  budgetYen: number | null;
  /** 今日時点の理想ライン(予算を期間で均等に使った額)。 */
  idealYen?: number | null;
  /** 予算なしのバーの基準(一覧の最大額)。 */
  maxYen: number;
  selected?: boolean;
  onClick?: () => void;
  /** 行の下に足す補足(目標画面の一言など)。 */
  children?: React.ReactNode;
}) {
  const state = budgetState({ spentYen, budgetYen, idealYen });
  const hasBudget = state !== 'none';
  const ratio = hasBudget
    ? Math.min(spentYen / budgetYen!, 1)
    : Math.min(spentYen / Math.max(maxYen, 1), 1);
  const idealRatio =
    hasBudget && idealYen !== null ? Math.min(Math.max(idealYen / budgetYen!, 0), 1) : null;

  const body = (
    <>
      <div className="flex items-center gap-3">
        <GenreBadge name={name === '未分類' ? null : name} size={28} />
        <span className="min-w-0 flex-1 truncate text-sm" style={{ color: 'var(--ink)' }}>
          {name}
        </span>
        {hasBudget ? (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ background: STATE_TRACK[state], color: STATE_COLOR[state] }}
          >
            <span aria-hidden>{STATE_ICON[state]} </span>
            {STATE_LABEL[state]}
          </span>
        ) : null}
        <span className="tabular shrink-0 text-sm" style={{ color: 'var(--ink)' }}>
          {formatYen(spentYen, { sign: 'never' })}
          {hasBudget ? (
            <span style={{ color: 'var(--ink-muted)' }}>
              {' / '}
              {formatYen(budgetYen!, { sign: 'never' })}
            </span>
          ) : null}
        </span>
      </div>
      <div
        aria-hidden
        className="relative mt-1.5 h-2 overflow-hidden rounded-full"
        style={{ background: STATE_TRACK[state] }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${ratio * 100}%`, background: STATE_COLOR[state] }}
        />
        {idealRatio !== null ? (
          <span
            className="absolute inset-y-0 w-0.5"
            style={{
              left: `calc(${idealRatio * 100}% - 1px)`,
              background: 'var(--ink)',
              opacity: 0.55,
            }}
          />
        ) : null}
      </div>
      {children}
    </>
  );

  const style = selected
    ? { background: 'var(--accent-track)', borderRadius: 'var(--radius-md)' }
    : undefined;
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={budgetSpokenLabel(name, spentYen, budgetYen)}
      className="block w-full px-2 py-1.5 text-left"
      style={style}
    >
      {body}
    </button>
  ) : (
    <div
      role="group"
      aria-label={budgetSpokenLabel(name, spentYen, budgetYen)}
      className="px-2 py-1.5"
      style={style}
    >
      {body}
    </div>
  );
}
