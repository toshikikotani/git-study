import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync('src/components/ui/bottom-sheet.tsx', 'utf8');

describe('閉じたシートを載せ続けない(iPhone で家計簿がメモリ不足で落ちた不具合)', () => {
  it('開閉は open で制御し、閉じたままの描画を強制しない(vaul は閉じている間 中身を描かない)', () => {
    expect(sheet).toContain('<Drawer.Root');
    expect(sheet).toMatch(/open=\{open\}/);
    expect(sheet).not.toContain('forceMount');
  });

  it('シートの背景は不透明の面で、常時ぼかす面(backdrop-filter)を増やさない', () => {
    expect(sheet).not.toMatch(/backdropFilter|backdrop-filter|backdrop-blur/);
  });

  it('読み上げ用の名前を持つ(Radix は Title が無いと警告する)', () => {
    expect(sheet).toContain('<Drawer.Title');
  });

  it('明細の行ごとにシートを持つ部品が、閉じたまま背景をぼかす面を増やさない(行のシートの数の上限)', () => {
    // split-editor は1行に4枚のシートを持つ。すべて BottomSheet 経由で、開くまで描かれない。
    const editor = readFileSync('app/(app)/transactions/split-editor.tsx', 'utf8');
    expect((editor.match(/<BottomSheet/g) ?? []).length).toBeGreaterThan(0);
    expect(editor).not.toMatch(/backdropFilter|backdrop-blur/);
  });
});
