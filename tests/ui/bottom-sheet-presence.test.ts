import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync('src/components/ui/bottom-sheet.tsx', 'utf8');

describe('閉じたシートを載せ続けない(iPhone で家計簿がメモリ不足で落ちた不具合)', () => {
  it('閉じているあいだは何も描かない(mounted でないときは null)', () => {
    expect(sheet).toMatch(/if \(!isClient \|\| !mounted\) return null/);
  });

  it('開いた見た目(shown)は、描いた直後ではなく次のフレームで付ける(スライドが動く)', () => {
    expect(sheet).toContain('requestAnimationFrame');
    expect(sheet).toMatch(/shown: open && entered/);
  });

  it('閉じる動きが終わってから外す(閉じる動きより長く待つ)', () => {
    const exit = Number(/SHEET_EXIT_MS = (\d+)/.exec(sheet)![1]);
    expect(exit).toBeGreaterThanOrEqual(400);
  });

  it('シートの背景(backdrop-filter)は、開いているときにだけ存在する(常時の面を増やさない)', () => {
    // backdropFilter を持つ要素は、return の中(mounted のときだけ描かれる部分)にだけある。
    const before = sheet.slice(0, sheet.indexOf('return createPortal('));
    expect(before).not.toContain('backdropFilter');
  });

  it('明細の行ごとにシートを持つ部品が、閉じたまま背景をぼかす面を増やさない(行のシートの数の上限)', () => {
    // split-editor は1行に4枚のシートを持つ。すべて BottomSheet 経由で、開くまで描かれない。
    const editor = readFileSync('app/(app)/transactions/split-editor.tsx', 'utf8');
    expect((editor.match(/<BottomSheet/g) ?? []).length).toBeGreaterThan(0);
    expect(editor).not.toMatch(/backdropFilter|backdrop-blur/);
  });
});
