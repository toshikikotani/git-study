import { useSyncExternalStore } from 'react';

import { keyboardInset } from './sheet';

/**
 * ソフトウェアキーボードが出ているかと、いま見えている範囲(visualViewport)。
 *
 * iPhone ではキーボードが出ても画面の高さ(100dvh)が変わらず、下のタブバーが入力欄とキーボードの
 * あいだに浮き、AIの入力欄は画面のまんなかに残っていた(本人の指摘「AI入力画面違和感」、ADR-111)。
 * 文字を打つ欄にフォーカスがあり、指で操作する端末(またはキーボードの高さが測れる)なら「出ている」と
 * みなす。タブバーは隠し、AIの画面は見えている範囲いっぱいにして入力欄をキーボードのすぐ上に置く。
 */

export type KeyboardState = {
  open: boolean;
  /** 見えている範囲の上端(px、レイアウトの上から)と高さ。閉じているときは 0。 */
  top: number;
  height: number;
};

/** これより低いものは、キーボードではなくツールバーの出入りとみなす。 */
export const KEYBOARD_MIN_PX = 120;

/**
 * 欄からフォーカスが外れてから「閉じた」とするまでの待ち(ミリ秒)。外れた瞬間に並びを戻すと、
 * 押したボタンが動いて押し損ねる(ADR-112)。キーボードが下がりきるのとおよそ同じ長さ。
 */
export const KEYBOARD_CLOSE_DELAY_MS = 250;

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'password', 'number']);

/** キーボードが出る欄か(文字を打つ入力欄・テキストエリア・編集できる要素)。 */
export function isTextEntry(
  el: {
    tagName: string;
    type?: string;
    readOnly?: boolean;
    disabled?: boolean;
    isContentEditable?: boolean;
  } | null,
): boolean {
  if (el === null) return false;
  if (el.isContentEditable === true) return true;
  if (el.readOnly === true || el.disabled === true) return false;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && TEXT_INPUT_TYPES.has(el.type ?? 'text');
}

/** 文字を打つ欄にフォーカスがあり、指で操作する端末か、キーボードの高さが測れるとき。 */
export function keyboardOpen(input: { typing: boolean; coarse: boolean; inset: number }): boolean {
  return input.typing && (input.coarse || input.inset >= KEYBOARD_MIN_PX);
}

const CLOSED: KeyboardState = { open: false, top: 0, height: 0 };
let current: KeyboardState = CLOSED;
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

function measure(): KeyboardState {
  const vv = window.visualViewport;
  const inset = vv
    ? keyboardInset({
        innerHeight: window.innerHeight,
        visualHeight: vv.height,
        visualOffsetTop: vv.offsetTop,
      })
    : 0;
  const open = keyboardOpen({
    typing: isTextEntry(document.activeElement as HTMLInputElement | null),
    coarse: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    inset,
  });
  if (!open) return CLOSED;
  return {
    open,
    top: Math.round(vv?.offsetTop ?? 0),
    height: Math.round(vv?.height ?? window.innerHeight),
  };
}

function update() {
  const next = measure();
  if (next.open === current.open && next.top === current.top && next.height === current.height)
    return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (stop === null) {
    const vv = window.visualViewport;
    let closing = 0;
    const onFocusOut = () => {
      window.clearTimeout(closing);
      closing = window.setTimeout(update, KEYBOARD_CLOSE_DELAY_MS);
    };
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', onFocusOut);
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    current = measure();
    stop = () => {
      window.clearTimeout(closing);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', onFocusOut);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stop !== null) {
      stop();
      stop = null;
    }
  };
}

export function useKeyboard(): KeyboardState {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => CLOSED,
  );
}
