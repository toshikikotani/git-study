import { describe, expect, it } from 'vitest';

import { buildBudgetUsageChartUrl, buildPayoffProgressChartUrl } from '@/lib/quickchart';

/**
 * QuickChart の URL 組み立て(本人発案)。実際に画像が正しく描かれるかは
 * 目視で確認済み(認証不要の公開サービスなので実URLを直接確認できた)。
 * ここでは URL の組み立てそのもの(パラメータ・値の丸め・色分け)だけを
 * 検証する。
 */

function decodeConfig(url: string): Record<string, unknown> {
  const c = new URL(url).searchParams.get('c');
  if (!c) throw new Error('c パラメータがありません');
  return JSON.parse(c) as Record<string, unknown>;
}

describe('buildPayoffProgressChartUrl', () => {
  it('QuickChart v4 の doughnut チャートの URL を返す', () => {
    const url = buildPayoffProgressChartUrl(0.62);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://quickchart.io/chart');
    expect(parsed.searchParams.get('version')).toBe('4');

    const config = decodeConfig(url) as { type: string; data: { datasets: [{ data: number[] }] } };
    expect(config.type).toBe('doughnut');
    expect(config.data.datasets[0].data).toEqual([62, 38]);
  });

  it('比率は0〜1の範囲に丸める(はみ出た入力を信用しない)', () => {
    const over = decodeConfig(buildPayoffProgressChartUrl(1.4)) as {
      data: { datasets: [{ data: number[] }] };
    };
    expect(over.data.datasets[0].data).toEqual([100, 0]);

    const under = decodeConfig(buildPayoffProgressChartUrl(-0.2)) as {
      data: { datasets: [{ data: number[] }] };
    };
    expect(under.data.datasets[0].data).toEqual([0, 100]);
  });
});

describe('buildBudgetUsageChartUrl', () => {
  it('横棒グラフで、枠の名前と消化率(%)を渡す', () => {
    const url = buildBudgetUsageChartUrl([
      { label: '生活費', usageRatio: 0.45 },
      { label: '浪費', usageRatio: 0.92 },
    ]);
    const config = decodeConfig(url) as {
      type: string;
      data: { labels: string[]; datasets: [{ data: number[] }] };
      options: { indexAxis: string };
    };
    expect(config.type).toBe('bar');
    expect(config.options.indexAxis).toBe('y');
    expect(config.data.labels).toEqual(['生活費', '浪費']);
    expect(config.data.datasets[0].data).toEqual([45, 92]);
  });

  it('70%以上の枠だけ超過色にする', () => {
    const config = decodeConfig(
      buildBudgetUsageChartUrl([
        { label: 'A', usageRatio: 0.69 },
        { label: 'B', usageRatio: 0.7 },
        { label: 'C', usageRatio: 1.0 },
      ]),
    ) as { data: { datasets: [{ backgroundColor: string[] }] } };
    const colors = config.data.datasets[0].backgroundColor;
    expect(colors[0]).not.toBe(colors[1]);
    expect(colors[1]).toBe(colors[2]);
  });
});
