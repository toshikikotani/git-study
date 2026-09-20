import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 明細には店名が含まれる。ソースマップを本番に出さない(NFR-04)
  productionBrowserSourceMaps: false,
  typedRoutes: true,
  // 本人発案(ADR-029):一度読み込んだ画面はそのまま表示し続け、
  // 明示的に下へ引っ張ったとき(src/components/ui/pull-to-refresh.tsx)
  // だけ最新化する。既定の staleTimes.dynamic は0秒(戻る・タブ切り替えの
  // たびに必ず再取得し loading.tsx が出る)のため、長めに伸ばす。
  // router.refresh()(pull-to-refresh から呼ぶ)はこの秒数に関係なく
  // 常にその場で最新化する。
  experimental: {
    staleTimes: {
      dynamic: 60 * 60 * 24,
    },
  },
};

export default nextConfig;
