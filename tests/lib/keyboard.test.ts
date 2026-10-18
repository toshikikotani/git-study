import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  isTextEntry,
  KEYBOARD_CLOSE_DELAY_MS,
  KEYBOARD_MIN_PX,
  keyboardOpen,
} from '@/lib/keyboard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/assistant',
}));
vi.mock('../../app/(app)/refresh-actions', () => ({ refreshAllAction: vi.fn() }));
vi.mock('@/lib/keyboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/keyboard')>()),
  useKeyboard: () => ({ open: true, top: 40, height: 420 }),
}));

import { AssistantChat } from '../../app/(app)/assistant/assistant-chat';

describe('キーボードが出る欄か(ADR-111)', () => {
  it('文字を打つ入力欄・テキストエリア・編集できる要素', () => {
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'search' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'number' })).toBe(true);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('ボタン・チェック・日付・読み取り専用・使えない欄は出ない', () => {
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextEntry({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTextEntry({ tagName: 'INPUT', type: 'date' })).toBe(false);
    expect(isTextEntry({ tagName: 'INPUT', type: 'text', readOnly: true })).toBe(false);
    expect(isTextEntry({ tagName: 'TEXTAREA', disabled: true })).toBe(false);
  });

  it('指で操作する端末なら、欄にフォーカスした時点で出ているとみなす(iPhone は高さが測れないことがある)', () => {
    expect(keyboardOpen({ typing: true, coarse: true, inset: 0 })).toBe(true);
    expect(keyboardOpen({ typing: false, coarse: true, inset: 300 })).toBe(false);
  });

  it('欄から外れても、キーボードが下がるまで少し待ってから閉じたとする(押したボタンが動かない)', () => {
    expect(KEYBOARD_CLOSE_DELAY_MS).toBeGreaterThanOrEqual(200);
    expect(KEYBOARD_CLOSE_DELAY_MS).toBeLessThanOrEqual(400);
    const source = readFileSync('src/lib/keyboard.ts', 'utf8');
    expect(source).toContain("document.addEventListener('focusout', onFocusOut);");
    expect(source).toContain('window.setTimeout(update, KEYBOARD_CLOSE_DELAY_MS)');
  });

  it('マウスの端末では、キーボードの高さが測れたときだけ', () => {
    expect(keyboardOpen({ typing: true, coarse: false, inset: 0 })).toBe(false);
    expect(keyboardOpen({ typing: true, coarse: false, inset: KEYBOARD_MIN_PX - 1 })).toBe(false);
    expect(keyboardOpen({ typing: true, coarse: false, inset: KEYBOARD_MIN_PX })).toBe(true);
  });
});

describe('キーボードが出ているあいだ(本人の指摘「AI入力画面違和感」、ADR-111)', () => {
  it('タブバーと読み取りの知らせを隠す(入力欄とキーボードのあいだに浮かせない)', () => {
    const shell = readFileSync('app/(app)/app-shell.tsx', 'utf8');
    expect(shell).toContain('const keyboard = useKeyboard();');
    expect(shell).toContain("style={keyboard.open ? { display: 'none' } : undefined}");
    expect(shell).toContain('!keyboard.open && reading + waiting + offlineWaiting + needInput > 0');
  });

  it('AIの画面は見えている範囲いっぱいにし、入力欄をキーボードのすぐ上に置く', () => {
    const raw = renderToString(h(AssistantChat, { variant: 'page' }));
    const root = raw.match(/^<div[^>]*>/)?.[0] ?? '';
    expect(root).toContain('position:fixed');
    expect(root).toContain('top:40px');
    expect(root).toContain('height:420px');
    // タブバーのぶんの高さを引かない。下の安全域の余白も足さない(キーボードが覆う)。
    expect(root).not.toContain('100dvh');
    expect(raw).not.toContain('safe-area-inset-bottom');
  });

  it('題は小さくして会話の行をふやす。おすすめの質問と入力欄は残す', () => {
    const raw = renderToString(h(AssistantChat, { variant: 'page' }));
    expect(raw).toMatch(/<h1 class="text-\[17px\] font-semibold">AI<\/h1>/);
    expect(raw).toContain('aria-label="おすすめの質問"');
    expect(raw).toContain('aria-label="送る"');
  });
});
