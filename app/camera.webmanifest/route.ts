import type { MetadataRoute } from 'next';

export function GET() {
  const manifest: MetadataRoute.Manifest = {
    id: '/camera',
    name: 'レシートカメラ',
    short_name: 'カメラ',
    start_url: '/camera',
    scope: '/',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    lang: 'ja',
    icons: [192, 512].map((size) => ({
      src: `/receipt-camera-${size}.png`,
      sizes: `${size}x${size}`,
      type: 'image/png',
      purpose: 'any',
    })),
  };
  return Response.json(manifest, { headers: { 'Content-Type': 'application/manifest+json' } });
}
