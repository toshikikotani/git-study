'use client';

import Link from 'next/link';

import { GenreBadge } from '@/components/ui/genre-badge';
import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { formatEstimate } from '@/domain/forecast/format';
import {
  WATCH_LIMIT,
  type WatchCategory,
  type WatchTone,
} from '@/domain/forecast/watch-categories';
import { useOpenCategory } from '../category-sheet';
import { Bar } from '../reports/category-progress';

const yen = (v: number) => `${Math.round(v).toLocaleString('ja-JP')}円`;

const TONES: Record<WatchTone, { label: string; color: string; bg: string }> = {
  over: { label: 'こえた', color: 'var(--state-over)', bg: 'var(--state-over-track)' },
  risk: { label: 'こえそう', color: 'var(--state-caution)', bg: 'var(--state-caution-track)' },
  near: { label: '8割をこえた', color: 'var(--state-caution)', bg: 'var(--state-caution-track)' },
};

function noteOf(c: WatchCategory): string {
  if (c.tone === 'over') {
    return c.p50 > c.spentYen
      ? `見込み ${formatEstimate(c.p50)}`
      : `${yen(c.spentYen - c.targetYen)}オーバー`;
  }
  if (c.tone === 'risk') return `見込み ${formatEstimate(c.p50)}`;
  return `あと${yen(c.targetYen - c.spentYen)}`;
}

/**
 * ホームの「気をつけたいカテゴリ」(本人の案、ADR-117):目標をこえた・こえそう・8割をこえたカテゴリを、
 * 自動で最大3つ。手で選ぶスイッチはやめた。行を押すとそのカテゴリ(⑦)。なければ何も出さない。
 * 「分析 › 目標」の「気をつけたい」と同じ一覧(ADR-127)。4つ以上あるときは「ほかN件」と添える。
 */
export function WatchCategories({ categories }: { categories: readonly WatchCategory[] }) {
  const open = useOpenCategory();
  if (categories.length === 0) return null;
  const shown = categories.slice(0, WATCH_LIMIT);
  const more = categories.length - shown.length;
  return (
    <section
      aria-label="気をつけたいカテゴリ"
      className="flex flex-col rounded-[22px] pt-2"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <div className="flex items-center justify-between gap-2 pr-2 pl-4">
        <h2 className="text-[17px] font-semibold">気をつけたいカテゴリ</h2>
        <Link
          href="/reports"
          className="flex min-h-11 items-center gap-1 px-2 text-[15px]"
          style={{ color: 'var(--accent)' }}
        >
          {more > 0 ? `ほか${more}件` : 'すべて'}
          <ChevronRightIcon />
        </Link>
      </div>
      {shown.map((c) => {
        const tone = TONES[c.tone];
        return (
          <button
            key={c.genreId}
            type="button"
            onClick={() => open(c.genreId)}
            className="flex min-h-14 w-full gap-3 px-4 py-3 text-left"
            style={{ borderTop: '1px solid var(--hairline)' }}
            aria-label={`${c.name}、${tone.label}。${yen(c.spentYen)} / 目標 ${yen(c.targetYen)}`}
          >
            <GenreBadge name={c.name} size={36} />
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-[16px] font-medium">{c.name}</span>
                <span
                  className="shrink-0 rounded-full px-2 py-1 text-[12px] font-bold"
                  style={{ color: tone.color, background: tone.bg }}
                >
                  {tone.label}
                </span>
              </span>
              <Bar spentYen={c.spentYen} p50={c.p50} targetYen={c.targetYen} />
              <span
                className="tabular flex justify-between gap-2 text-[13px]"
                style={{ color: 'var(--ink-muted)' }}
              >
                <span>
                  {yen(c.spentYen)} / 目標 {yen(c.targetYen)}
                </span>
                <span>{noteOf(c)}</span>
              </span>
            </span>
          </button>
        );
      })}
    </section>
  );
}
