import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 明細には店名が含まれる。ソースマップを本番に出さない(NFR-04)
  productionBrowserSourceMaps: false,
  typedRoutes: true,
};

export default nextConfig;
