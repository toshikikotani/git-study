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

  it('自前のカメラはやめた(iPhone のカメラをそのまま開く、ADR-133)', () => {
    expect(existsSync('src/components/receipt/receipt-camera.tsx')).toBe(false);
    expect(existsSync('src/components/receipt/receipt-camera.css')).toBe(false);
    expect(existsSync('src/features/import/document-detect.ts')).toBe(false);
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
  });
});

describe('レシートを撮るは iPhone のカメラをそのまま開く(v5 変更1、ADR-133)', () => {
  it('カメラを開くのは、ファイルの選び方の「カメラで撮る」(capture="environment")', () => {
    const capture = read('src/components/receipt/camera-capture.tsx');
    expect(capture).toContain('accept="image/*"');
    expect(capture).toContain('capture="environment"');
    expect(capture).toContain('input.current?.click()');
  });

  it('＋・長押し・記録するシートからは、押したその場でカメラを開く(画面を移らない)', () => {
    const shell = read('app/(app)/app-shell.tsx');
    expect(shell).not.toContain("router.push('/camera')");
    expect(shell).toContain('onCamera={openCamera}');
    expect(shell).toContain('openCamera();');
    // 長押しは指を離したところで開く(押している最中はブラウザがカメラを開かせない)。
    expect(shell).toContain('if (cameraOnRelease.take()) openCamera();');
    const sheet = read('app/(app)/record-sheet.tsx');
    expect(sheet).not.toContain('href="/camera"');
    expect(sheet).not.toContain('href="/photos"');
  });

  it('撮って戻ると「もう1枚撮る」「確かめる」。確かめるは保存前のレシートの1件めを開く', () => {
    const sheet = read('app/(app)/capture-sheet.tsx');
    expect(sheet).toContain('もう1枚撮る');
    expect(sheet).toContain('確かめる');
    const shell = read('app/(app)/app-shell.tsx');
    expect(shell).toContain("router.push('/spending/review?receipt=next')");
  });

  it('ホーム画面のアイコン(/camera)は、大きな「撮る」ボタンが1つだけの画面', () => {
    const entry = read('app/(app)/camera/camera-entry.tsx');
    expect(entry).not.toContain('<main');
    expect(entry).not.toContain('<h1');
    expect(entry).toContain('CameraCaptureInput');
    expect(entry).toContain("'撮る'");
    expect(entry).toContain("router.replace('/spending/review?receipt=next')");
  });
});
