import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 明細の行を押して開く「記録を直す」(ADR-099・101)。記録すると同じ画面(RecordSheet の edit)を使う。
 * キーボードまわりはどのシートも BottomSheet で直す(bottom-sheet.test.ts)。
 */
describe('明細の「記録を直す」(ADR-101)', () => {
  const src = readFileSync('app/(app)/transactions/split-editor.tsx', 'utf8');

  it('記録すると同じ画面(RecordSheet の edit)で開き、下にレシートの品目を出す', () => {
    expect(src).toContain('<RecordSheet');
    expect(src).toMatch(/edit=\{\{\s+initial:/);
    expect(src).toContain('footer: (');
    // 名前を直しても保存されなかった:名前も送る
    expect(src).toContain('description: v.name');
  });

  it('「名前」と呼ぶ欄を作らない(iPhone が「連絡先を自動入力」を出す、ADR-099)', () => {
    expect(src).not.toContain('aria-label="名前"');
  });

  it('行の中の簡単な編集の「保存」はいつでも押せる:変えていなければ「閉じる」', () => {
    expect(src).not.toContain('名前・日付・金額・カテゴリを変えると保存できます');
    expect(src).not.toContain('disabled={saving || !canSaveSimpleEdit}');
    expect(src).toContain("simpleEditUnchanged ? '閉じる' : '保存'");
  });
});
