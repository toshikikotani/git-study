/**
 * デザインQA用の、Supabase(認証 + PostgREST)の偽サーバー。
 * POST /__scenario で、明細・目標・ジャンルを差し替える。
 */
import http from 'node:http';

export const GENRES = [
  { id: '10000000-0000-0000-0000-000000000001', name: '交通・車両' },
  { id: '10000000-0000-0000-0000-000000000002', name: '外食' },
  { id: '10000000-0000-0000-0000-000000000003', name: '日用品' },
];
const USER = {
  id: '00000000-0000-0000-0000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'qa@example.com',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};

let scenario = { transactions: [], plans: [], planItems: [] };

function filterByDate(rows, params) {
  let out = rows;
  for (const v of params.getAll('occurred_on')) {
    const [op, val] = [v.slice(0, v.indexOf('.')), v.slice(v.indexOf('.') + 1)];
    if (op === 'gte') out = out.filter((r) => r.occurred_on >= val);
    if (op === 'lte') out = out.filter((r) => r.occurred_on <= val);
    if (op === 'lt') out = out.filter((r) => r.occurred_on < val);
    if (op === 'gt') out = out.filter((r) => r.occurred_on > val);
  }
  return out;
}

export function startFake(port) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      res.setHeader('content-type', 'application/json');
      const single = (req.headers.accept || '').includes('vnd.pgrst.object');
      const send = (rows) => res.end(JSON.stringify(single ? (rows[0] ?? {}) : rows));
      if (u.pathname === '/__scenario') {
        scenario = { transactions: [], plans: [], planItems: [], ...JSON.parse(body) };
        return res.end('{}');
      }
      if (u.pathname === '/auth/v1/user') return res.end(JSON.stringify(USER));
      const table = u.pathname.startsWith('/rest/v1/') ? u.pathname.slice(9) : null;
      if (table === null) return res.end('{}');
      if (req.method !== 'GET') {
        res.statusCode = 201;
        return res.end('[]');
      }
      if (table === 'genres') {
        return send(
          GENRES.map((g, i) => ({
            ...g,
            sort_order: (i + 1) * 10,
            budget_yen: null,
            show_on_home: false,
            icon_key: null,
            color_index: null,
            user_id: USER.id,
          })),
        );
      }
      if (table === 'transactions') {
        if (
          u.searchParams.get('limit') === '1' &&
          !(u.searchParams.get('select') ?? '').includes('id')
        ) {
          const sorted = [...scenario.transactions].sort((a, b) =>
            a.occurred_on.localeCompare(b.occurred_on),
          );
          return send(sorted.slice(0, 1).map((r) => ({ occurred_on: r.occurred_on })));
        }
        const rows = filterByDate(scenario.transactions, u.searchParams).sort((a, b) =>
          b.occurred_on.localeCompare(a.occurred_on),
        );
        return send(rows);
      }
      if (table === 'spending_plans') {
        const id = (u.searchParams.get('id') ?? '').replace('eq.', '');
        return send(id ? scenario.plans.filter((p) => p.id === id) : scenario.plans);
      }
      if (table === 'spending_plan_items') {
        const pid = (u.searchParams.get('plan_id') ?? '').replace('eq.', '');
        return send(pid ? scenario.planItems.filter((i) => i.plan_id === pid) : scenario.planItems);
      }
      if (table === 'accounts') {
        return send([
          {
            id: '30000000-0000-0000-0000-000000000001',
            name: '現金',
            kind: 'cash',
            sort_order: 1,
            user_id: USER.id,
          },
        ]);
      }
      return send([]);
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && process.argv[1].endsWith('fake-supabase.mjs')) {
  await startFake(Number(process.env.PORT ?? 54999));
}
