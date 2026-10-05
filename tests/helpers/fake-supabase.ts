/**
 * Supabase のクエリビルダの最小の代用(テスト用)。テーブルごとの行を持ち、
 * select / eq / gte / lte / lt / gt / in / order / range / limit / single / maybeSingle を
 * 順に適用して { data, error } を返す。データ取得の組み立て(列・ページ分け・並び)を
 * ネットワーク無しで通すためのもの。
 */

type Row = Record<string, unknown>;
type Op = (rows: Row[]) => Row[];

export type FakeTables = Record<string, Row[]>;

export function fakeSupabase(tables: FakeTables, user = { id: 'user-1' }) {
  const calls: { table: string; select: string }[] = [];

  function from(table: string) {
    const ops: Op[] = [];
    let selectCols = '*';
    let single: 'single' | 'maybe' | null = null;
    const builder: Record<string, unknown> = {};
    const chain = (op: Op) => {
      ops.push(op);
      return builder;
    };
    const cmp = (col: string, test: (v: never) => boolean) =>
      chain((rows) => rows.filter((r) => r[col] !== undefined && test(r[col] as never)));
    Object.assign(builder, {
      select: (cols: string) => {
        selectCols = cols;
        calls.push({ table, select: cols });
        return builder;
      },
      eq: (col: string, v: unknown) => chain((rows) => rows.filter((r) => r[col] === v)),
      neq: (col: string, v: unknown) => chain((rows) => rows.filter((r) => r[col] !== v)),
      gte: (col: string, v: string | number) => cmp(col, (x) => (x as string | number) >= v),
      lte: (col: string, v: string | number) => cmp(col, (x) => (x as string | number) <= v),
      gt: (col: string, v: string | number) => cmp(col, (x) => (x as string | number) > v),
      lt: (col: string, v: string | number) => cmp(col, (x) => (x as string | number) < v),
      in: (col: string, values: unknown[]) =>
        chain((rows) => rows.filter((r) => values.includes(r[col]))),
      order: (col: string, o?: { ascending?: boolean }) =>
        chain((rows) =>
          [...rows].sort((a, b) => {
            const x = a[col] as string | number;
            const y = b[col] as string | number;
            const d = x < y ? -1 : x > y ? 1 : 0;
            return o?.ascending === false ? -d : d;
          }),
        ),
      range: (from: number, to: number) => chain((rows) => rows.slice(from, to + 1)),
      limit: (n: number) => chain((rows) => rows.slice(0, n)),
      single: () => {
        single = 'single';
        return builder;
      },
      maybeSingle: () => {
        single = 'maybe';
        return builder;
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        try {
          let rows = [...(tables[table] ?? [])];
          for (const op of ops) rows = op(rows);
          // PostgREST は1回に最大1,000行しか返さない。
          if (single === null) rows = rows.slice(0, 1000);
          const cols = selectCols === '*' ? null : selectCols.split(',').map((c) => c.trim());
          const shaped = cols
            ? rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])))
            : rows;
          const data = single ? (shaped[0] ?? null) : shaped;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        } catch (e) {
          return Promise.reject(e).then(resolve, reject);
        }
      },
    });
    return builder;
  }

  return {
    client: {
      from,
      auth: { getUser: async () => ({ data: { user }, error: null }) },
    },
    calls,
  };
}
