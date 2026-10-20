import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 押したらすぐ切り替わる(本人の指摘「このボタン押した後に固まる」、ADR-117)。
 * - スイッチ・確認のボタンは、押した瞬間に見た目を変え、保存はうしろで続ける(できなければ戻して理由を出す)
 * - 保存のあとに router.refresh() を重ねない。サーバーアクションの返事にいまの画面の作り直しが入る
 *   (Next.js の Server Actions)。重ねると往復が2回になり、そのぶん待っていた
 */

const read = (file: string) => readFileSync(file, 'utf8');

describe('スイッチは押したらすぐ切り替わる(ADR-117)', () => {
  it('カテゴリの設定:固定費・月末の見込みは手元の状態で切り替え、ほかのボタンを止めない', () => {
    const body = read('app/(app)/settings/categories/[genreId]/settings-body.tsx');
    expect(body).toContain('checked={isFixed}');
    expect(body).toContain('checked={!isFixed && !forecastClosed}');
    expect(body).not.toContain('checked={data.isFixed}');
    // 押した直後に set(next)、だめなら set(!next) で戻す。
    expect(body).toMatch(/set\(next\);[\s\S]*set\(!next\);/);
  });

  it('これからの支払い:「固定費から外す」「固定費にする」は先に見た目を変える', () => {
    const upcoming = read('app/(app)/upcoming/upcoming-actions.tsx');
    expect(upcoming).toMatch(/setReleased\(c\);\s*const result = await releaseCategoryFixedAction/);
    expect(upcoming).toMatch(
      /setDone\(\(prev\) => new Set\(prev\)\.add\(d\.key\)\);\s*const result/,
    );
  });

  it('カテゴリのシート:「完了」ですぐ閉じ、保存はうしろで。できなければ入れた額のまま開き直す', () => {
    const sheet = read('app/(app)/category-sheet.tsx');
    expect(sheet).toMatch(/close\(\);\s*if \(amount === null/);
    expect(sheet).toContain('load(id, { amountYen: amount, error: result.error })');
  });
});

describe('保存のあとに router.refresh() を重ねない(往復を1回に、ADR-117)', () => {
  const files = [
    'app/(app)/category-sheet.tsx',
    'app/(app)/settings/categories/category-list.tsx',
    'app/(app)/upcoming/upcoming-actions.tsx',
    'app/(app)/savings/monthly-target.tsx',
    'app/(app)/plan/delete-plan-button.tsx',
    'app/(app)/plan/plan-builder.tsx',
    'app/(app)/plan/review-card.tsx',
    'app/(app)/plan/unrecorded-sheet.tsx',
    'app/(app)/plan/edit/goal-editor.tsx',
    'app/(app)/record-sheet.tsx',
    'app/(app)/reports/category-progress.tsx',
    'app/(app)/spending/category/[genreKey]/goal-target-edit.tsx',
    'app/(app)/transactions/duplicates/duplicate-list.tsx',
    'app/(app)/welcome/welcome-flow.tsx',
    'app/(app)/assistant/assistant-chat.tsx',
  ];
  for (const file of files) {
    it(file, () => {
      expect(read(file)).not.toMatch(/router\.refresh\(\);/);
    });
  }

  it('カテゴリの設定:保存の共通処理(run)と月の目安も重ねない', () => {
    const body = read('app/(app)/settings/categories/[genreId]/settings-body.tsx');
    expect(body).not.toMatch(/router\.refresh\(\);/);
  });
});
