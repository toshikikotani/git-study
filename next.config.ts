import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 明細には店名が含まれる。ソースマップを本番に出さない(NFR-04)
  productionBrowserSourceMaps: false,
  typedRoutes: true,
  // AI とつなぐ のレシートの確かめの画面は、MCP Apps の部品を HTML の中に入れて返す(実行時に読む。ADR-146)。
  outputFileTracingIncludes: {
    '/api/mcp': ['./node_modules/@modelcontextprotocol/ext-apps/dist/src/app-with-deps.js'],
  },
  // AI のアプリとつなぐ同意画面は、ほかのサイトの枠の中に出させない(押させる罠を防ぐ、ADR-143)。
  async headers() {
    return [
      {
        source: '/oauth/authorize',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
  // 本人発案(ADR-029):一度読み込んだ画面はそのまま表示し続け、
  // 明示的に下へ引っ張ったとき(src/components/ui/pull-to-refresh.tsx)
  // だけ最新化する。既定の staleTimes.dynamic は0秒(戻る・タブ切り替えの
  // たびに必ず再取得し loading.tsx が出る)のため、長めに伸ばす。
  // router.refresh()(pull-to-refresh から呼ぶ)はこの秒数に関係なく
  // 常にその場で最新化する。
  experimental: {
    staleTimes: {
      // タブの prefetch={true} は static を見る。dynamic だけ伸ばしても、
      // 先読みした画面は既定の5分で捨てられ、再訪のたびに取り直す。
      dynamic: 60 * 60 * 24,
      static: 60 * 60 * 24,
    },
  },
};

export default nextConfig;
