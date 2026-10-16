import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 明細の編集シート(ADR-099)。キーボードまわりはどのシートも BottomSheet で直す(bottom-sheet.test.ts)。 */
describe('明細の編集シート(ADR-099)', () => {
  const src = readFileSync('app/(app)/transactions/split-editor.tsx', 'utf8');

  it('店の名前の欄は「名前」と呼ばず、自動入力を止める(iPhone が「連絡先を自動入力」を出さない)', () => {
    expect(src).not.toContain('aria-label="名前"');
    expect(src).toMatch(/aria-label="レシート名"\s+autoComplete="off"/);
  });

  it('「保存」はいつでも押せる:変えていなければ「閉じる」、足りなければ理由を出す', () => {
    expect(src).not.toContain('名前・日付・金額・カテゴリを変えると保存できます');
    expect(src).not.toContain('disabled={saving || !canSaveSimpleEdit}');
    expect(src).toContain("simpleEditUnchanged ? '閉じる' : '保存'");
    expect(src).toContain("'カテゴリを選んでください。'");
  });
});
