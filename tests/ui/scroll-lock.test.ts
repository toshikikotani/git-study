import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 画面に固定した層(AIの会話)のあいだ、ページそのものを動かさない(本人の指摘「ぶるぶる振動」、ADR-112)。
// 指の動き・フォーカス・スクロールは実機の Safari でしか起きないため、ここでは手当ての有無を見る。
const lock = readFileSync('src/components/ui/use-scroll-lock.ts', 'utf8');
const pull = readFileSync('src/components/ui/pull-to-refresh.tsx', 'utf8');

describe('ページを動かさない(ADR-112)', () => {
  it('ページのスクロールを止め、外したら元に戻す', () => {
    expect(lock).toContain("root.style.overflow = 'hidden';");
    expect(lock).toContain("root.style.overscrollBehavior = 'none';");
    expect(lock).toContain('root.style.overflow = before.overflow;');
    expect(lock).toContain('window.scrollTo(0, scrollY);');
  });

  it('層の中で、スクロールできる欄の外の指の動きは止める(入力欄の中は止めない)', () => {
    expect(lock).toContain(
      "document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });",
    );
    expect(lock).toContain('!isTextEntry(target as HTMLInputElement)');
    expect(lock).toContain('scrollParentWithin(target, layer.current!) === null');
  });

  it('iPhone で入力欄を押したとき、ページごと持ち上げない', () => {
    expect(lock).toContain('isIOSWebKit(navigator.userAgent, navigator.maxTouchPoints)');
    expect(lock).toContain("target.style.transform = 'translateY(-2000px)';");
  });

  it('送る・おすすめの質問・マイクを押しても入力欄のフォーカスを外さない(押した瞬間に並びが変わらない)', () => {
    const chat = readFileSync('app/(app)/assistant/assistant-chat.tsx', 'utf8');
    expect(chat).toContain('const keepFocus = (e: React.MouseEvent) => e.preventDefault();');
    expect(chat.match(/onMouseDown=\{keepFocus\}/g)).toHaveLength(3);
  });

  it('引っぱって最新化は、data-no-pull の層では始めない', () => {
    expect(pull).toContain("e.target.closest('[data-no-pull]') !== null");
  });
});
