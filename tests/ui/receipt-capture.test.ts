import { existsSync, readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// CSS Modules は読み込まず、クラス名をそのまま返す(PostCSS を通さない)。
vi.mock('../../app/(app)/receipt-entry-menu.module.css', () => ({
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));

import { ReceiptEntryMenu } from '../../app/(app)/receipt-entry-menu';

/**
 * レシートを撮る・写真から読み取るの直し(本人の指摘「固定で紫」「へんな画面一個増えてる。普通にボタンだけで
 * いいのに」、ADR-126)。
 */

const read = (path: string) => readFileSync(path, 'utf8');
const PURPLE =
  /#(?:a27bff|9b7cff|b9a4ff|bda4ff|bfa5ff|c0a8ff|c5adff|c5aeff|c7b1ff|bba0ff|c9b5ff)\b/i;

function menu() {
  return renderToString(
    h(ReceiptEntryMenu, {
      open: true,
      onClose: () => {},
      onCamera: () => {},
      onFiles: () => {},
      onManual: () => {},
    }),
  );
}

describe('色はアプリのテーマに合わせる(紫の固定をやめる)', () => {
  it('＋のボタンに紫を上書きしない', () => {
    const shell = read('app/(app)/app-shell.tsx');
    expect(shell).not.toMatch(PURPLE);
    expect(shell).not.toContain("'--action'");
  });

  it('＋のメニューはテーマのトークンだけで描く(昼・夜・選んだ色に合わせる)', () => {
    const css = read('app/(app)/receipt-entry-menu.module.css');
    expect(css).not.toMatch(PURPLE);
    // 背景の暗幕(影)以外に、決まった色を書かない。
    const fixed = css.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    expect(fixed).toEqual([]);
    expect(css).toContain('background: var(--surface-raised)');
    expect(css).toContain('color: var(--ink)');
  });

  it('カメラは黒・白・灰色だけ。テーマの色(--action)を紫で上書きしない', () => {
    const css = read('src/components/receipt/receipt-camera.css');
    expect(css).not.toMatch(PURPLE);
    expect(css).not.toContain('--action');
    expect(css).not.toContain('--receipt-purple');
  });
});

describe('＋のメニュー(デザイン v3-11)', () => {
  it('撮る・写真から読み取る・手で記録する・長押しの設定', () => {
    const html = menu();
    for (const label of ['レシートを撮る', '写真から読み取る', '手で記録する', '長押しの設定']) {
      expect(html).toContain(label);
    }
    expect(html.replace(/<!-- -->/g, '')).toContain('長押し：レシートを撮る');
  });

  it('画面を移らない:撮るはその場でカメラ、写真は端末の写真を選ぶ画面をすぐ開く', () => {
    const html = menu();
    expect(html).not.toContain('href="/camera"');
    expect(html).not.toContain('href="/photos"');
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*multiple/);
  });

  it('長押しの設定は別の画面にせず、メニューの中で開く', () => {
    const html = menu();
    expect(html).toMatch(/aria-expanded="false"[^>]*aria-controls="receipt-entry-long-press"/);
    const src = read('app/(app)/receipt-entry-menu.tsx');
    expect(src).not.toContain('FiArrowLeft');
    expect(src).toContain('role="radiogroup"');
    expect(src).toContain('aria-label="＋を長押ししたとき"');
  });
});

describe('増えていた画面をなくす', () => {
  it('写真を選ぶための自前の画面(/photos・写真一覧)はなくし、端末の写真選択をすぐ開く', () => {
    expect(existsSync('app/(app)/photos/page.tsx')).toBe(false);
    expect(existsSync('src/components/receipt/photo-library.tsx')).toBe(false);
    const camera = read('src/components/receipt/receipt-camera.tsx');
    expect(camera).not.toContain("from './photo-library'");
    expect(camera).not.toContain('receipt-camera__library');
    expect(camera).toContain('const openPhotos = () => photoInput.current?.click();');
    expect(camera).toContain('すべての写真');
  });

  it('カメラのページは説明を挟まず、すぐカメラを開く(閉じたら前の画面へ)', () => {
    const entry = read('app/(app)/camera/camera-entry.tsx');
    expect(entry).not.toContain('ホーム画面からすぐ撮影');
    expect(entry).not.toContain('<main');
    expect(entry).not.toContain('<h1');
    expect(entry).toContain("onDone={() => router.replace('/transactions/receipt')}");
    expect(entry).toContain('router.back()');
  });

  it('＋・長押し・記録するシートからは、その場でカメラを開く。撮り終えたら読み取り結果へ', () => {
    const shell = read('app/(app)/app-shell.tsx');
    expect(shell).not.toContain("router.push('/camera')");
    expect(shell).toContain('onCamera={() => setCameraOpen(true)}');
    expect(shell).toContain("router.push('/transactions/receipt');");
    const sheet = read('app/(app)/record-sheet.tsx');
    expect(sheet).not.toContain('href="/camera"');
    expect(sheet).not.toContain('href="/photos"');
  });
});
