'use client';

import { formatYen } from '@/domain/money';

/**
 * 日別支出の濃淡をカレンダー形式のヒートマップで表示する。
 * 明るさ = その日の支出額。タップで金額を表示。
 */
export function SpendingHeatmap({
  daySpend,
  monthStart,
  monthEnd,
  today,
}: {
  daySpend: Record<string, number>;
  monthStart: string;
  monthEnd: string;
  today: string;
}) {
  const start = new Date(monthStart + 'T00:00:00');
  const end = new Date(monthEnd + 'T00:00:00');
  const todayDate = new Date(today + 'T00:00:00');

  // 月の全日を生成
  const days: { date: string; yen: number; day: number; isFuture: boolean }[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const iso = cursor.toISOString().slice(0, 10);
    days.push({
      date: iso,
      yen: daySpend[iso] ?? 0,
      day: cursor.getDate(),
      isFuture: cursor > todayDate,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  const maxYen = Math.max(1, ...days.map((d) => d.yen));
  const startDow = start.getDay(); // 0=Sun

  // 週の列（日曜始まり）
  const weeks: (typeof days[number] | null)[][] = [];
  let week: (typeof days[number] | null)[] = Array(startDow).fill(null);
  for (const d of days) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  const intensity = (yen: number) => {
    if (yen <= 0) return 0;
    const ratio = yen / maxYen;
    if (ratio < 0.15) return 1;
    if (ratio < 0.35) return 2;
    if (ratio < 0.6) return 3;
    if (ratio < 0.85) return 4;
    return 5;
  };

  const colors = [
    'var(--plane)',
    'color-mix(in srgb, var(--accent) 20%, var(--plane))',
    'color-mix(in srgb, var(--accent) 40%, var(--plane))',
    'color-mix(in srgb, var(--accent) 60%, var(--plane))',
    'color-mix(in srgb, var(--accent) 80%, var(--plane))',
    'var(--accent)',
  ];

  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

  return (
    <section
      className="glass space-y-3 rounded-2xl p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
        日別支出の濃淡
      </h2>

      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        明るさはその日の支出額を表しています。タップで金額を確認できます。
      </p>

      <div className="flex gap-1">
        <div className="flex w-5 shrink-0 flex-col gap-1 text-[10px]" style={{ color: 'var(--ink-muted)' }}>
          {weekdays.map((w) => (
            <div key={w} className="flex h-6 items-center justify-center">
              {w}
            </div>
          ))}
        </div>

        <div className="flex flex-1 gap-1">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-1 flex-col gap-1">
              {week.map((cell, di) => {
                if (!cell) {
                  return <div key={di} className="h-6 rounded-sm" />;
                }
                const level = cell.isFuture ? 0 : intensity(cell.yen);
                return (
                  <div
                    key={di}
                    className="flex h-6 items-center justify-center rounded-sm text-[10px] tabular"
                    style={{
                      background: colors[level],
                      color: level >= 3 ? 'var(--on-action)' : 'var(--ink-secondary)',
                      opacity: cell.isFuture ? 0.4 : 1,
                    }}
                    title={`${cell.date}: ${cell.yen > 0 ? formatYen(cell.yen, { sign: 'never' }) : '支出なし'}`}
                  >
                    {cell.day}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-1 text-[10px]" style={{ color: 'var(--ink-muted)' }}>
        <span>少</span>
        {colors.map((c, i) => (
          <div key={i} className="h-3 w-3 rounded-sm" style={{ background: c }} />
        ))}
        <span>多</span>
      </div>
    </section>
  );
}
