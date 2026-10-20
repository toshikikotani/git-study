import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SavingsCard } from '../../app/(app)/_home/savings-card';

const visible = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ');

describe('ホームの貯金:毎月の貯金目標は1か所で(デザイン v3-1、ADR-108)', () => {
  it('貯金目標・いま・月末の見込み・目標までの差を出す', () => {
    const text = visible(
      renderToString(
        h(SavingsCard, {
          untilLabel: '10月31日まで',
          balance: { p50: 83000, incomeYen: 275000 },
          monthlyTargetYen: 100000,
          nowYen: 128000,
        }),
      ),
    );
    expect(text).toContain('貯金目標 · 毎月');
    expect(text).toContain('10.0万円');
    expect(text).toContain('+12.8万円');
    expect(text).toContain('+8.3万円');
    expect(text).toContain('収入 27.5万 − 支出 19.2万。目標まであと約1.7万円。');
    expect(text).not.toContain('目標はまだありません');
  });

  it('貯金目標を決めていなければ、決める入口を出す(貯金の画面で決める)', () => {
    const html = renderToString(
      h(SavingsCard, {
        untilLabel: '10月31日まで',
        balance: null,
        monthlyTargetYen: 0,
        nowYen: null,
      }),
    );
    expect(visible(html)).toContain('毎月の貯金目標を決める');
    expect(html).toContain('href="/savings"');
  });

  it('貯金の画面で毎月の貯金目標を決める・直す(設定の値。AIも同じ値を見る)', () => {
    const page = readFileSync('app/(app)/savings/page.tsx', 'utf8');
    expect(page).toContain('const target = settings?.monthlySavingsTargetYen ?? 0;');
    expect(page).toContain('<MonthlyTarget initialYen={target} />');
    const actions = readFileSync('app/(app)/savings/actions.ts', 'utf8');
    expect(actions).toContain('updateAppSettings({ monthlySavingsTargetYen: amountYen })');
  });
});

describe('ホームの並び(デザイン v3-1)', () => {
  it('今日の目安 → 今期の見通し → これからの支払い → 貯金 → 今日の記録', () => {
    const section = readFileSync('app/(app)/_home/today-section.tsx', 'utf8');
    expect(section.indexOf('<TodayCard')).toBeLessThan(section.indexOf('{upcoming}'));
    expect(section.indexOf('{upcoming}')).toBeLessThan(section.indexOf('<SavingsCard'));
    const page = readFileSync('app/(app)/page.tsx', 'utf8');
    expect(page.indexOf('<UpcomingPayments />')).toBeLessThan(page.indexOf('<TodayRecords />'));
  });
});
