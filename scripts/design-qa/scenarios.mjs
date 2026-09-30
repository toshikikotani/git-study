/**
 * デザインQAの状態(R6)。今日は FAKE_NOW(2026-09-15)に固定する。
 * 明細・目標は、偽の Supabase の POST /__scenario で差し替える。
 */
import { GENRES } from './fake-supabase.mjs';

export const TODAY = '2026-09-15';
const T = GENRES[0].id; // 交通・車両
const D = GENRES[1].id;
const N = GENRES[2].id;
const ACC = '30000000-0000-0000-0000-000000000001';

let n = 0;
const row = (date, yen, extra = {}) => ({
  id: `20000000-0000-0000-0000-${String(++n).padStart(12, '0')}`,
  occurred_on: date,
  description: extra.description ?? '電車',
  merchant_name: extra.merchant_name ?? 'JR',
  amount_yen: -yen,
  genre_id: T,
  is_transfer: false,
  review_status: 'auto_ok',
  account_id: ACC,
  source: 'manual',
  memo: null,
  payment_method: 'one_time',
  must_pay: false,
  status: 'actual',
  kind: 'normal',
  branch_name: null,
  reconcile_diff_yen: null,
  classified_by: 'ai',
  reviewed_at: null,
  created_at: '2026-09-01T00:00:00Z',
  ...extra,
});
const d = (m, day) => `2026-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const prevMonth = [row(d(8, 3), 1200), row(d(8, 12), 800), row(d(8, 20), 2600), row(d(8, 28), 400)];
const sparse = [row(d(9, 2), 640), row(d(9, 9), 320), row(d(9, 9), 1100), row(d(9, 13), 540)];
const daily = Array.from({ length: 15 }, (_, i) => row(d(9, i + 1), 380 + ((i * 137) % 900)));
const scheduled = [
  row(d(9, 18), 4200, { status: 'scheduled', description: '新幹線', merchant_name: 'JR東海' }),
  row(d(9, 25), 1500, { status: 'scheduled', description: '定期券', merchant_name: 'JR' }),
];

const tenk = Array.from({ length: 10000 }, (_, i) => {
  const month = 3 + (i % 7);
  const maxDay = month === 9 ? 15 : 28;
  return row(d(month, 1 + (i % maxDay)), 200 + (i % 60) * 25, {
    merchant_name: `店${i % 200}`,
    description: `購入${i % 200}`,
  });
});

const plan = (id, from, to) => ({
  id,
  period_start: from,
  period_end: to,
  step_percent: 10,
  created_at: '2026-09-01T00:00:00Z',
});
const items = (planId, transport) =>
  [
    { plan_id: planId, genre_id: T, target_yen: transport, ai_suggested_yen: null, reason: null },
    { plan_id: planId, genre_id: D, target_yen: 30000, ai_suggested_yen: null, reason: null },
  ].map((i) => ({ ...i, user_id: '00000000-0000-0000-0000-000000000001' }));

const P1 = '40000000-0000-0000-0000-000000000001';
const goalFull = (yen) => ({
  plans: [plan(P1, d(9, 1), d(9, 30))],
  planItems: items(P1, yen),
});
const goalPartial = (yen) => ({
  plans: [plan(P1, d(9, 10), d(10, 9))],
  planItems: items(P1, yen),
});

/** @type {{id:string,label:string,data:object,opts?:object}[]} */
export const STATES = [
  { id: '01-empty', label: '取引0件', data: {} },
  { id: '02-one', label: '1件(記録初日)', data: { transactions: [row(TODAY, 480)] } },
  {
    id: '03-sparse',
    label: '飛び飛び(交通費)・前月あり・目標なし',
    data: { transactions: [...prevMonth, ...sparse] },
  },
  {
    id: '04-daily-goal',
    label: '毎日・目標あり(全期間)・前月あり',
    data: { transactions: [...prevMonth, ...daily], ...goalFull(20000) },
  },
  { id: '05-tenk', label: '1万件', data: { transactions: tenk } },
  {
    id: '06-goal-partial',
    label: '月と目標期間が一部だけ重なる',
    data: { transactions: [...prevMonth, ...sparse, ...scheduled], ...goalPartial(9000) },
  },
  { id: '07-no-goal-no-prev', label: '目標なし・前月なし', data: { transactions: sparse } },
  {
    id: '08-over',
    label: '予定あり・目安超過・予算超過',
    data: { transactions: [...prevMonth, ...daily, ...scheduled], ...goalFull(6000) },
  },
  {
    id: '09-maxtext',
    label: '文字サイズ最大',
    data: { transactions: [...prevMonth, ...daily, ...scheduled], ...goalFull(20000) },
    opts: { fontScale: 3 },
  },
  {
    id: '10-dark',
    label: 'ダークモード',
    data: { transactions: [...prevMonth, ...daily, ...scheduled], ...goalFull(20000) },
    opts: { dark: true },
  },
  {
    id: '11-reduced-transparency',
    label: '「透明度を下げる」オン',
    data: { transactions: [...prevMonth, ...daily, ...scheduled], ...goalFull(20000) },
    opts: { reducedTransparency: true },
  },
  {
    id: '12-dark-maxtext-over',
    label: 'ダーク+文字サイズ最大+超過',
    data: { transactions: [...prevMonth, ...daily, ...scheduled], ...goalFull(6000) },
    opts: { dark: true, fontScale: 3 },
  },
];

export const GENRE_KEY = T;
