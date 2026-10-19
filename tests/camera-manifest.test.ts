import { describe, expect, it } from 'vitest';
import { GET } from '../app/camera.webmanifest/route';
import manifest from '../app/manifest';

describe('カメラのホーム画面起動', () => {
  it('専用アイコンからはカメラを起動し、通常アプリの起動先は維持する', async () => {
    const response = GET();
    const camera = await response.json();
    expect(response.headers.get('content-type')).toBe('application/manifest+json');
    expect(camera.start_url).toBe('/camera');
    expect(camera.id).toBe('/camera');
    expect(camera.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual([
      '192x192',
      '512x512',
    ]);
    expect(manifest().start_url).toBe('/spending');
    expect(manifest().shortcuts?.[0]?.url).toBe('/camera');
  });
});
