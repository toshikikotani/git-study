import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    h('a', { href }, children),
}));

import { GoalCard } from '../../../app/(app)/plan/goal-card';
import { buildGoalCard } from '@/features/goals/card';
import { buildGoalView } from '@/features/goals/view';
import { toLedgerEntries } from '@/features/spending/views';
import { ledgerTx } from '../../helpers/ledger';

const plan = {
  id: 'p',
  periodStart: '2026-09-29',
  periodEnd: '2026-10-06',
  items: [
    { genreId: 'dining', genreName: '外食', targetYen: 20000 },
    { genreId: 'hobby', genreName: '娯楽・趣味', targetYen: 30000 },
  ],
};
const names = new Map([
  ['dining', '外食'],
  ['hobby', '娯楽・趣味'],
]);
function view(txs: ReturnType<typeof ledgerTx>[], today = '2026-09-29') {
  return buildGoalView({
    plan,
    entries: toLedgerEntries(txs),
    genreNames: names,
    today,
    transactions: txs,
  });
}
const base = [
  ledgerTx({ id: 't', occurredOn: '2026-09-29', genreId: 'dining', amountYen: -636 }),
  ledgerTx({
    id: 'r',
    occurredOn: '2026-10-03',
    label: '発表会',
    genreId: 'hobby',
    genreName: '娯楽・趣味',
    amountYen: -26540,
    kind: 'special',
    status: 'scheduled',
  }),
  ledgerTx({
    id: 'p',
    occurredOn: '2026-10-04',
    label: '打ち上げ',
    genreId: 'dining',
    amountYen: -5000,
    status: 'scheduled',
  }),
  ledgerTx({
    id: 'u',
    occurredOn: '2026-09-29',
    label: '不明',
    genreId: null,
    genreName: null,
    amountYen: -300,
  }),
];

/** 表示文字列に出る金額(N円)を全部拾う。 */
function amountsIn(text: string): number[] {
  return [...text.replace(/<[^>]+>/g, ' ').matchAll(/(\d{1,3}(?:,\d{3})*)円/g)].map((m) =>
    Number(m[1]!.replace(/,/g, '')),
  );
}

describe('F2 目標カード(受け入れ基準2)', () => {
  it('主役は「今日あと○円」1つ。1日の目安・理想ペースとの差は内訳に入る', () => {
    const m = buildGoalCard(view(base), '2026-09-29');
    // 予定 31,540 を引いた 18,460 ÷ 8 = 2,307 / 今日 936円(未分類300含む)
    expect(m.primary).toMatchObject({ label: '今日あと', amountYen: 2307 - 936 });
    expect(m.details.map((d) => d.key)).toContain('daily');
    expect(m.details.map((d) => d.key)).toContain('pace');
  });

  it('同じ数値が別の意味で2回出ない(画面に出る金額はすべて別の値)', () => {
    const html = renderToString(h(GoalCard, { model: buildGoalCard(view(base), '2026-09-29') }));
    // 予定の一覧の明細金額と、予定の合計は「同じ予定」の表現なので別扱い。主役・内訳・行の金額で重複が無いこと
    const model = buildGoalCard(view(base), '2026-09-29');
    const labelled = [model.primary.amountYen, ...model.details.map((d) => d.amountYen)].filter(
      (v): v is number => v !== null && v > 0,
    );
    expect(new Set(labelled).size).toBe(labelled.length);
    expect(amountsIn(html).length).toBeGreaterThan(3);
  });

  it('今日まだ使っていないとき、1日の目安=今日あと が同じ値になるので内訳から落とす', () => {
    const m = buildGoalCard(view([base[1]!, base[2]!]), '2026-09-29');
    expect(m.primary.amountYen).toBe(2307);
    expect(m.details.some((d) => d.key === 'daily')).toBe(false);
  });

  it('差は符号ではなく言葉(「理想より○円多い/少ない」)', () => {
    const m = buildGoalCard(view(base), '2026-09-29');
    const pace = m.details.find((d) => d.key === 'pace')!;
    expect(pace.text).toMatch(/^理想より[\d,]+円(多い|少ない)$/);
    expect(pace.text).not.toMatch(/[+−-]\d/);
  });

  it('状態バッジは注意・超過のときだけ(余裕のときは出さない)', () => {
    const ok = buildGoalCard(view([base[0]!]), '2026-09-29');
    expect(ok.badge).toBeNull();
    const html = renderToString(h(GoalCard, { model: ok }));
    expect(html).not.toContain('余裕');
    // 予定込みで予算を超える → 超過
    const over = buildGoalCard(
      view([
        ...base,
        ledgerTx({
          id: 'x',
          occurredOn: '2026-10-05',
          genreId: 'hobby',
          amountYen: -20000,
          status: 'scheduled',
        }),
      ]),
      '2026-09-29',
    );
    expect(over.badge).toMatchObject({ state: 'over' });
  });

  it('予定の行は展開でき、日付・名前・金額・ジャンルを一覧で見せる', () => {
    const html = renderToString(
      h(GoalCard, { model: buildGoalCard(view(base), '2026-09-29') }),
    ).replace(/<!-- -->/g, '');
    expect(html).toContain('予定の支出 2件');
    expect(html).toContain('発表会');
    expect(html).toContain('打ち上げ');
    expect(html).toContain('26,540円');
    expect(html).toContain('娯楽・趣味');
    expect(html).toContain('<details');
  });

  it('未分類の支出は「未分類 ○円(目標に未反映)」の行で、分類画面へのリンク', () => {
    const html = renderToString(
      h(GoalCard, { model: buildGoalCard(view(base), '2026-09-29') }),
    ).replace(/<!-- -->/g, '');
    expect(html).toContain('未分類 300円(目標に未反映)');
    expect(html).toContain('href="/spending/category/none"');
  });

  it('ソースに、同じ数値を並べる旧レイアウト(headline と今日使える額の併記)が残っていない', () => {
    const page = readFileSync(new URL('../../../app/(app)/plan/page.tsx', import.meta.url), 'utf8');
    expect(page).not.toContain('今日使える額');
    expect(page).not.toContain('guidance.headline');
  });
});
