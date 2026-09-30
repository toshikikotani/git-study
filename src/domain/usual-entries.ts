/**
 * 「いつもの」予測(N2本人要件)。
 *
 * 「曜日・時間帯・直近の履歴から、よくある組み合わせ(店・カテゴリ・金額)を
 * 最大3件、入力画面の上部に出す。タップすると内容が入り、そのまま保存できる」。
 *
 * 時間帯は平日/休日 × 朝・昼・夕方・夜の8区分に丸める(厳密な時刻の一致では
 * データが少なすぎてほぼ毎回0件になる)。まず今の区分に近い履歴から探し、
 * 件数が足りなければ全期間で頻度の高い組み合わせを足して3件に近づける。
 */

export type TimeSegment = 'morning' | 'afternoon' | 'evening' | 'night';

export function timeSegmentOf(hour: number): TimeSegment {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

export function isWeekendDay(weekday: number): boolean {
  return weekday === 0 || weekday === 6;
}

export type UsualEntryHistoryRow = {
  storeName: string;
  genreId: string | null;
  genreName: string | null;
  /** 支出は正の数で持つ(呼び出し側で符号を外して渡す)。 */
  amountYen: number;
  /** 0=日曜〜6=土曜。 */
  weekday: number;
  /** 記録した時刻(created_at の時)。無ければこの行は時間帯の絞り込みに使わない。 */
  hour: number | null;
};

export type UsualEntryCandidate = {
  storeName: string;
  genreId: string | null;
  genreName: string | null;
  amountYen: number;
  occurrences: number;
};

type GroupKey = string;

function groupKeyOf(row: UsualEntryHistoryRow): GroupKey {
  return `${row.storeName}\u0000${row.genreId ?? ''}\u0000${row.amountYen}`;
}

function groupAndSort(rows: readonly UsualEntryHistoryRow[]): UsualEntryCandidate[] {
  const byKey = new Map<GroupKey, UsualEntryCandidate>();
  for (const row of rows) {
    const key = groupKeyOf(row);
    const existing = byKey.get(key);
    if (existing) {
      existing.occurrences += 1;
    } else {
      byKey.set(key, {
        storeName: row.storeName,
        genreId: row.genreId,
        genreName: row.genreName,
        amountYen: row.amountYen,
        occurrences: 1,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => b.occurrences - a.occurrences);
}

export function suggestUsualEntries(
  history: readonly UsualEntryHistoryRow[],
  now: { weekday: number; hour: number },
  limit = 3,
): UsualEntryCandidate[] {
  const nowWeekend = isWeekendDay(now.weekday);
  const nowSegment = timeSegmentOf(now.hour);

  const matching = history.filter(
    (row) =>
      row.hour !== null &&
      isWeekendDay(row.weekday) === nowWeekend &&
      timeSegmentOf(row.hour) === nowSegment,
  );

  const primary = groupAndSort(matching);
  if (primary.length >= limit) return primary.slice(0, limit);

  const seen = new Set(
    primary.map((c) => `${c.storeName}\u0000${c.genreId ?? ''}\u0000${c.amountYen}`),
  );
  const fallback = groupAndSort(history).filter(
    (c) => !seen.has(`${c.storeName}\u0000${c.genreId ?? ''}\u0000${c.amountYen}`),
  );

  return [...primary, ...fallback].slice(0, limit);
}
