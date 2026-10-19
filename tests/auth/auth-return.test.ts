import { describe, expect, it } from 'vitest';

import { safeReturnTo } from '@/lib/auth-return';

describe('ログイン後の安全な戻り先', () => {
  it.each([
    '/camera',
    '/camera?source=shortcut',
    '/spending?capture=1',
    '/transactions/receipt?camera=1',
    '/spending?search=%E3%82%B9%E3%82%AE%20%E8%96%AC%E5%B1%80',
    '/reports/month?month=2026-10#summary',
  ])('入口のパス・query を残す: %s', (target) => {
    expect(safeReturnTo(target)).toBe(target);
  });

  it.each([
    null,
    undefined,
    '',
    'https://example.com/camera',
    '//example.com/camera',
    'javascript:alert(1)',
    'camera',
    '/\\example.com',
    '/\n/example.com',
    '/camera\u0000',
    '/%2fexample.com',
    '/%5cexample.com',
    '/%252fexample.com',
    '/camera?next=%0ahttps://example.com',
    '/login',
    '/login?returnTo=/camera',
    '/login/password',
    '/camera/../login',
    '/camera/%2e%2e/login',
    '/api/receipt',
    '/api',
    '/%61pi/receipt',
    '/auth/callback',
    '/_next/image',
    '/manifest.webmanifest',
    '/unknown-page',
    '/camera/%E0%A4%A',
  ])('外部・認証経路・壊れた入力はホームへ戻す: %s', (target) => {
    expect(safeReturnTo(target)).toBe('/');
  });
});
