/**
 * QuickChart.io でグラフ画像の URL を組み立てる(本人発案)。
 *
 * ── なぜこれを使うのか ──────────────────────────────────────
 * Discord の Embed も LINE の画像メッセージも「画像の URL」を渡すだけで
 * 添付できる。QuickChart は API キー不要の公開サービス(無料枠)で、
 * Chart.js の設定を URL に載せるだけで PNG が返る。認証情報が要らない
 * ため、本人が何も設定しなくてもすぐ使える(Google 連携のような
 * OAuth クライアント作成は不要)。
 *
 * ── ここが持つ責務 ──────────────────────────────────────────
 * 「何を描くか」(棒グラフか、色は何色か)はここが決める。
 * 「何のデータを渡すか」(完済の進捗率など)は呼び出し側
 * (features/briefs/notify.ts 等)の業務判断。
 *
 * URL の長さは Discord・LINE どちらも十分な上限(数千文字)があるため、
 * 気にする必要はない(このアプリで作る設定は数百文字程度)。
 */

const QUICKCHART_BASE_URL = 'https://quickchart.io/chart';

/** globals.css の役割色と揃える(青=返済・予算の残り、赤=超過)。 */
const COLOR_ACCENT = '#2a78d6';
const COLOR_TRACK = '#e6ebf3';
const COLOR_OVER = '#e34948';

function buildChartUrl(config: Record<string, unknown>, width: number, height: number): string {
  const query = new URLSearchParams({
    // QuickChart の既定は Chart.js 2(indexAxis 等の v3+ 構文が効かない)。
    // ここで書いている設定はすべて v4 構文なので明示する(実機で確認済み)。
    version: '4',
    w: String(width),
    h: String(height),
    bkg: 'white',
    c: JSON.stringify(config),
  });
  return `${QUICKCHART_BASE_URL}?${query.toString()}`;
}

/**
 * 完済の進捗(0〜1)をドーナツ1枚にする(朝配信、本人発案)。
 * percent はラベル用に丸めた整数(データラベルにそのまま出る)。
 */
export function buildPayoffProgressChartUrl(progressRatio: number): string {
  const ratio = Math.min(1, Math.max(0, progressRatio));
  const percent = Math.round(ratio * 100);

  return buildChartUrl(
    {
      type: 'doughnut',
      data: {
        labels: ['返済済み', '残り'],
        datasets: [
          {
            data: [percent, 100 - percent],
            backgroundColor: [COLOR_ACCENT, COLOR_TRACK],
          },
        ],
      },
      options: { cutout: '65%' },
    },
    400,
    260,
  );
}

/**
 * 枠ごとの予算消化率を横棒にする(FR-20 の浪費アラート、本人発案)。
 * 70% を超えている枠が一目でわかるよう、超過分だけ色を変える。
 */
export function buildBudgetUsageChartUrl(
  usages: readonly { label: string; usageRatio: number }[],
): string {
  const labels = usages.map((u) => u.label);
  const percents = usages.map((u) => Math.round(u.usageRatio * 100));
  const colors = usages.map((u) => (u.usageRatio >= 0.7 ? COLOR_OVER : COLOR_ACCENT));

  return buildChartUrl(
    {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data: percents, backgroundColor: colors }],
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { min: 0, suggestedMax: 100 } },
      },
    },
    400,
    Math.max(120, 60 + usages.length * 40),
  );
}
