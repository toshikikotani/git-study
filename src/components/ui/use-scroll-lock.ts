'use client';

import { useEffect, type RefObject } from 'react';

import { isTextEntry } from '@/lib/keyboard';
import { isIOSWebKit } from './shared-element';

/**
 * 画面に固定した層(AIの会話)を出しているあいだ、ページそのものを動かさない。
 *
 * iPhone でキーボードを出すと、ページを指で少し動かせ、固定した層がそのあとを1コマ遅れて追うので
 * 画面がぶるぶる揺れ、入力欄がキーボードの下に隠れることがあった(本人の指摘「ぶるぶる振動したみたいな
 * 画面の動き」「スクロールが少しできてしまう」、ADR-112)。
 * - ページ(html)のスクロールを止める。層の中で指を動かしても、スクロールできる欄(会話・おすすめの質問)
 *   の外ならページを動かさない
 * - iPhone で入力欄を押したとき、Safari が入力欄を見せようとページごと持ち上げるのを止める
 *   (入力欄はもともとキーボードのすぐ上に置く)。react-aria の usePreventScroll と同じ手口
 */
export function useScrollLock(layer: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const before = { overflow: root.style.overflow, overscroll: root.style.overscrollBehavior };
    const scrollY = window.scrollY;
    root.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';
    window.scrollTo(0, 0);

    const inLayer = (target: EventTarget | null): target is Element =>
      target instanceof Element && layer.current !== null && layer.current.contains(target);

    let block = false;
    const onTouchStart = (e: TouchEvent) => {
      const target = e.target;
      block =
        inLayer(target) &&
        !isTextEntry(target as HTMLInputElement) &&
        scrollParentWithin(target, layer.current!) === null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (block && e.cancelable) e.preventDefault();
    };
    // 入力欄にフォーカスが移る瞬間だけ上へずらし、Safari に「見えている」と思わせて持ち上げを止める。
    const ios = isIOSWebKit(navigator.userAgent, navigator.maxTouchPoints);
    const onFocus = (e: FocusEvent) => {
      const target = e.target;
      if (!ios || !inLayer(target) || !(target instanceof HTMLElement)) return;
      if (!isTextEntry(target as HTMLInputElement)) return;
      target.style.transform = 'translateY(-2000px)';
      requestAnimationFrame(() => {
        target.style.transform = '';
      });
    };
    // それでもページが動いたら、上に戻す(層の中の欄にフォーカスがあるときだけ。シートの入力欄は動かさない)。
    const onScroll = () => {
      if (window.scrollY !== 0 && inLayer(document.activeElement)) window.scrollTo(0, 0);
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    document.addEventListener('focus', onFocus, true);
    window.addEventListener('scroll', onScroll);
    return () => {
      document.removeEventListener('touchstart', onTouchStart, { capture: true });
      document.removeEventListener('touchmove', onTouchMove, { capture: true });
      document.removeEventListener('focus', onFocus, true);
      window.removeEventListener('scroll', onScroll);
      root.style.overflow = before.overflow;
      root.style.overscrollBehavior = before.overscroll;
      window.scrollTo(0, scrollY);
    };
  }, [layer, enabled]);
}

/** target から root までで、中身があふれてスクロールできる要素(無ければ null)。 */
function scrollParentWithin(target: Element, root: Element): Element | null {
  for (let el: Element | null = target; el !== null && el !== root; el = el.parentElement) {
    const style = window.getComputedStyle(el);
    const scrollsY = /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
    const scrollsX = /auto|scroll/.test(style.overflowX) && el.scrollWidth > el.clientWidth;
    if (scrollsY || scrollsX) return el;
  }
  return null;
}
