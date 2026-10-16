import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 縦長のシート(記録する・カテゴリなど、入力欄のあるもの)は、上のつまみでだけ引っぱれる(ADR-097)。
 * シートのどこを押しても引っぱりが始まると、入力欄の上で指が少し動いただけでシートが動き、入力しづらい。
 * (iPhone をまねたブラウザで、入力欄の上を指で下へなぞるとシートが656px動いていたのが、0pxになるのを確かめた)
 */
describe('BottomSheet:どのシートも、つまみでだけ引っぱれる(ADR-097・099)', () => {
  const src = readFileSync('src/components/ui/bottom-sheet.tsx', 'utf8');

  it('つまみでだけ引っぱれ、キーボードに合わせた vaul の手当てを止める', () => {
    expect(src).toMatch(/\bhandleOnly\n/);
    // キーボードに合わせてシートを持ち上げない(iPhone も持ち上げるので二重になり、入力中の欄が画面の外に出ていた)
    expect(src).toContain('repositionInputs={false}');
  });

  it('中の操作(入力欄のカーソル・スクロール)をブラウザに任せる', () => {
    expect(src).toContain("style={{ touchAction: 'manipulation' }}");
  });

  it('つまみ(Drawer.Handle)を描く', () => {
    expect(src).toContain('<Drawer.Handle');
  });
});
