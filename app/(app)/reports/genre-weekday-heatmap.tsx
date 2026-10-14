'use client';

import { formatYen } from '@/domain/money';

export type GenreWeekdayCell = {
  genreName: string;
  weekday: number; // 0=Sun
  yen: number;
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const MAX_GENRES = 6;

/**
 * ジャンル × 曜日の支出傾向をヒートマップで分析表示する。
 * 「どの曜日に何を使いやすいか」が一目でわかる。
 */
export function GenreWeekdayHeatmap({ cells }: { cells: readonly GenreWeekdayCell[] }) {
  if (cells.length === 0) return null;

  // ジャンルごとに集計
  const byGenre = new Map<string, number[]>();
  for (const c of cells) {
    const arr = byGenre.get(c.genreName) ?? Array(7).fill(0);
    arr[c.weekday] = (arr[c.weekday] ?? 0) + c.yen;
    byGenre.set(c.genreName, arr);
  }

  // 合計が大きい順に上位ジャンル
  const ranked = [...byGenre.entries()]
    .map(([name, days]) => ({
      name,
      days,
      total: days.reduce((s, v) => s + v, 0),
    }))
    .filter((g) => g.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_GENRES);

  if (ranked.length === 0) return null;

  const maxCell = Math.max(1, ...ranked.flatMap((g) => g.days));

  const intensity = (yen: number) => {
    if (yen <= 0) return 0;
    const ratio = yen / maxCell;
    if (ratio < 0.2) return 1;
    if (ratio < 0.4) return 2;
    if (ratio < 0.65) return 3;
    if (ratio < 0.85) return 4;
    return 5;
  };

  const colors = [
    'var(--plane)',
    'color-mix(in srgb, var(--accent) 18%, var(--plane))',
    'color-mix(in srgb, var(--accent) 38%, var(--plane))',
    'color-mix(in srgb, var(--accent) 58%, var(--plane))',
    'color-mix(in srgb, var(--accent) 78%, var(--plane))',
    'var(--accent)',
  ];

  return (
    <section
      className="glass space-y-3 rounded-2xl p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
        曜日とジャンルの傾向
      </h2>

      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        どの曜日に何を使いやすいかを分析しています。明るさはその曜日の支出額です。
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th
                className="w-20 py-1 text-left font-normal"
                style={{ color: 'var(--ink-muted)' }}
              />
              {WEEKDAYS.map((w) => (
                <th
                  key={w}
                  className="py-1 text-center font-normal"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map((g) => (
              <tr key={g.name}>
                <td
                  className="truncate py-1 pr-2"
                  style={{ color: 'var(--ink-secondary)' }}
                  title={g.name}
                >
                  {g.name.length > 6 ? `${g.name.slice(0, 5)}…` : g.name}
                </td>
                {g.days.map((yen, di) => {
                  const level = intensity(yen);
                  const label =
                    yen >= 10000
                      ? `${Math.round(yen / 1000)}k`
                      : yen >= 1000
                        ? `${Math.round(yen / 100) / 10}k`
                        : yen;
                  return (
                    <td key={di} className="p-1">
                      <div
                        className="flex h-7 items-center justify-center rounded-sm"
                        style={{
                          background: colors[level],
                          color: level >= 3 ? 'var(--on-action)' : 'var(--ink-muted)',
                        }}
                        title={`${g.name} / ${WEEKDAYS[di]}: ${
                          yen > 0 ? formatYen(yen, { sign: 'never' }) : 'なし'
                        }`}
                      >
                        {yen > 0 ? (
                          <span className="text-[11px] tabular opacity-80">{label}</span>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        className="flex items-center justify-end gap-1 text-[11px]"
        style={{ color: 'var(--ink-muted)' }}
      >
        <span>少</span>
        {colors.map((c, i) => (
          <div key={i} className="h-3 w-3 rounded-sm" style={{ background: c }} />
        ))}
        <span>多</span>
      </div>
    </section>
  );
}
