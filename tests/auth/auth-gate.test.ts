import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { authGate } from '@/lib/auth-gate';

describe('認証ガードの行き先', () => {
  it('ログイン済みでログイン画面を開いたら、ホームへ送る(ログイン画面に取り残さない)', () => {
    expect(authGate('/login', true)).toBe('to-home');
    expect(authGate('/login', false)).toBe('pass');
  });

  it('未ログインなら、画面はログイン画面へ、API は 401', () => {
    expect(authGate('/', false)).toBe('to-login');
    expect(authGate('/spending', false)).toBe('to-login');
    expect(authGate('/api/forecast', false)).toBe('unauthorized');
    expect(authGate('/', true)).toBe('pass');
  });

  it('マニフェストは誰でも見られる', () => {
    expect(authGate('/manifest.webmanifest', false)).toBe('pass');
    expect(authGate('/manifest.webmanifest', true)).toBe('pass');
  });

  it('ログインできたら、ホームをページごと開く(移動の直後に今の画面を読み直さない)', () => {
    const form = readFileSync('app/login/login-form.tsx', 'utf8');
    expect(form).toContain("window.location.replace('/')");
    expect(form).not.toMatch(/^\s*router\.(push|refresh)\(/m);
  });
});
