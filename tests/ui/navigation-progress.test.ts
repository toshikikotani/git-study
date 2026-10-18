import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { navigationTarget } from '@/components/ui/navigation-progress';

/**
 * 画面を移るのを待っているあいだの細い帯(ADR-117)。保存のあとは端末の作り置きが消え、次の画面は
 * サーバーの返事を待つ。そのあいだ固まって見えていた。枠は出さず(2026-10-02 にやめた)、待っていることだけ示す。
 */

const here = { origin: 'https://app.example', pathname: '/settings/categories', search: '' };
const anchor = (href: string, attrs: Record<string, string> = {}) => ({
  href,
  target: attrs.target ?? '',
  hasAttribute: (name: string) => name in attrs,
});

describe('どのリンクで帯を出すか', () => {
  it('同じアプリの別の画面へのリンク', () => {
    expect(navigationTarget(anchor('https://app.example/settings/categories/x'), here)).toBe(
      '/settings/categories/x',
    );
    expect(navigationTarget(anchor('/reports?tab=goal'), here)).toBe('/reports?tab=goal');
  });

  it('いまの画面・外のサイト・新しいタブ・ダウンロードでは出さない', () => {
    expect(navigationTarget(anchor('https://app.example/settings/categories'), here)).toBeNull();
    expect(navigationTarget(anchor('https://other.example/'), here)).toBeNull();
    expect(navigationTarget(anchor('/reports', { target: '_blank' }), here)).toBeNull();
    expect(navigationTarget(anchor('/export.csv', { download: '' }), here)).toBeNull();
  });
});

describe('帯の出し方', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  const source = readFileSync('src/components/ui/navigation-progress.tsx', 'utf8');

  it('150ms を過ぎるまでは見せない(すぐ切り替わるときはちらつかない)', () => {
    expect(source).toContain('const SHOW_AFTER_MS = 150;');
    expect(source).toContain('animationDelay: `${SHOW_AFTER_MS}ms`');
    expect(css).toMatch(/\.nav-progress \{[^}]*opacity: 0;[^}]*animation: nav-progress-in/);
  });

  it('Next の Link が受け取った押下だけを見る。移ったら(パス・検索が変わったら)消す', () => {
    expect(source).toContain('if (!e.defaultPrevented');
    expect(source).toContain('setPending(null)');
    const shell = readFileSync('app/(app)/app-shell.tsx', 'utf8');
    expect(shell).toContain('<NavigationProgress />');
  });
});
