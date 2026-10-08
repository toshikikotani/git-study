'use client';

import Link from 'next/link';
import type { Route } from 'next';

import { GenreBadge } from '@/components/ui/genre-badge';
import { SharedElement, sharedName } from '@/components/ui/shared-element';
import {
  STATE_COLOR,
  STATE_ICON,
  STATE_LABEL,
  STATE_TRACK,
  budgetSpokenLabel,
  budgetState,
} from '@/domain/budget-state';
import { genreColorVar } from '@/domain/genre-style';
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
  scheduledYen = 0,
  maxYen,
  selected = false,
  onClick,
  href,
  sharedKey,
  hideName = false,
  children,
}: {
  name: string;
  spentYen: number;
  budgetYen: number | null;
  /** 今日時点の理想ライン(予算を期間で均等に使った額)。 */
  idealYen?: number | null;
  /** このジャンルの予定の支出(今日より先)。予算から差し引いて見せる。 */
  scheduledYen?: number;
  /** 予算なしのバーの基準(一覧の最大額)。 */
  maxYen: number;
  selected?: boolean;
  onClick?: () => void;
  /** カテゴリ詳細へ遷移する。行のアイコン・名前・金額が、詳細のヘッダーへ共有要素として動く。 */
  href?: string;
  /** 共有要素の名前に使うカテゴリのキー(未分類は 'none')。href とセットで渡す。 */
  sharedKey?: string;
  /** 名前を見た目では出さない(名前が画面の見出しにあるとき)。読み上げには残す。 */
  hideName?: boolean;
  /** 行の下に足す補足(目標画面の一言など)。 */
  children?: React.ReactNode;
}) {
  const state = budgetState({ spentYen, budgetYen, idealYen, scheduledYen });
  const hasBudget = state !== 'none';
  const freeYen = hasBudget ? Math.max(budgetYen! - scheduledYen - spentYen, 0) : 0;
  const scheduledRatio = hasBudget
    ? Math.min(scheduledYen / budgetYen!, 1 - Math.min(spentYen / budgetYen!, 1))
    : 0;
  // 余裕のときは状態を出さない(注意・超過・予定で確保済みのときだけ)。
  const ratio = hasBudget
    ? Math.min(spentYen / budgetYen!, 1)
    : Math.min(spentYen / Math.max(maxYen, 1), 1);
  const idealRatio =
    hasBudget && idealYen !== null ? Math.min(Math.max(idealYen / budgetYen!, 0), 1) : null;

  const body = (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {shared(
          sharedKey && sharedName.icon(sharedKey),
          <GenreBadge name={name === '未分類' ? null : name} size={28} />,
        )}
        <span
          className={`min-w-0 flex-1 text-sm ${hideName ? 'sr-only' : ''}`}
          style={{ color: 'var(--ink)' }}
        >
          {shared(
            sharedKey && sharedName.title(sharedKey),
            <span className="block truncate">{name}</span>,
          )}
        </span>
        {hideName ? <span aria-hidden className="flex-1" /> : null}
        {hasBudget && state !== 'ok' ? (
          <span
            className="shrink-0 rounded-full px-2 py-1 text-xs font-semibold"
            style={{ background: STATE_TRACK[state], color: STATE_COLOR[state] }}
          >
            <span aria-hidden>{STATE_ICON[state]} </span>
            {STATE_LABEL[state]}
          </span>
        ) : null}
        <span className="tabular min-w-0 text-sm" style={{ color: 'var(--ink)' }}>
          {shared(
            sharedKey && sharedName.amount(sharedKey),
            <span>{formatYen(spentYen, { sign: 'never' })}</span>,
          )}
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
        className="relative mt-2 h-2 overflow-hidden rounded-full"
        style={{ background: STATE_TRACK[state] }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${ratio * 100}%`,
            background: genreColorVar(name === '未分類' ? null : name),
          }}
        />
        {scheduledRatio > 0 ? (
          <div
            className="absolute inset-y-0"
            style={{
              left: `${ratio * 100}%`,
              width: `${scheduledRatio * 100}%`,
              background:
                'repeating-linear-gradient(45deg, var(--ink-muted) 0 3px, transparent 3px 6px)',
              opacity: 0.55,
            }}
          />
        ) : null}
        {idealRatio !== null ? (
          <span
            className="absolute inset-y-0 w-1"
            style={{
              left: `calc(${idealRatio * 100}% - 1px)`,
              background: 'var(--ink)',
              opacity: 0.55,
            }}
          />
        ) : null}
      </div>
      {scheduledYen > 0 && hasBudget ? (
        <p className="tabular mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          予定 {formatYen(scheduledYen, { sign: 'never' })} / 自由に使える残り{' '}
          {formatYen(freeYen, { sign: 'never' })}
        </p>
      ) : null}
      {children}
    </>
  );

  const style = selected
    ? { background: 'var(--accent-track)', borderRadius: 'var(--radius-inner)' }
    : undefined;
  const spoken = `${budgetSpokenLabel(name, spentYen, budgetYen)}${scheduledYen > 0 ? `、予定${formatYen(scheduledYen, { sign: 'never' })}${state === 'reserved' ? 'で確保済み' : ''}` : ''}`;
  if (href !== undefined) {
    return (
      <Link
        href={href as Route}
        aria-label={`${spoken}。タップして詳細を開く`}
        className="min-h-11 block w-full px-2 py-2 text-left"
        style={style}
      >
        {body}
      </Link>
    );
  }
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`${budgetSpokenLabel(name, spentYen, budgetYen)}${scheduledYen > 0 ? `、予定${formatYen(scheduledYen, { sign: 'never' })}${state === 'reserved' ? 'で確保済み' : ''}` : ''}`}
      className="min-h-11 block w-full px-2 py-2 text-left"
      style={style}
    >
      {body}
    </button>
  ) : (
    <div
      role="group"
      aria-label={`${budgetSpokenLabel(name, spentYen, budgetYen)}${scheduledYen > 0 ? `、予定${formatYen(scheduledYen, { sign: 'never' })}${state === 'reserved' ? 'で確保済み' : ''}` : ''}`}
      className="px-2 py-2"
      style={style}
    >
      {body}
    </div>
  );
}

/** 共有要素(key があるときだけ ViewTransition で包む)。 */
function shared(
  name: string | undefined | '' | false | null,
  node: React.ReactNode,
): React.ReactNode {
  return name ? <SharedElement name={name}>{node}</SharedElement> : node;
}
