import { describe, expect, it } from 'vitest';

import { visibleGroups } from '../../src/components/ui/more-menu';

const hrefs = (isOwner: boolean) =>
  visibleGroups(isOwner).flatMap((g) => g.items.map((i) => i.href));

describe('連携系は、オーナー以外には出さない', () => {
  const OWNER_ONLY = [
    '/settings/gmail',
    '/settings/google',
    '/settings/rescued-emails',
    '/briefs',
    '/debts', // 借金(負債)まわり
  ];

  it('オーナーには、連携系がすべて出る', () => {
    for (const h of OWNER_ONLY) expect(hrefs(true)).toContain(h);
  });

  it('オーナー以外には、連携系が出ない。ふつうの機能(家計簿の入力・パスワード)は出る', () => {
    for (const h of OWNER_ONLY) expect(hrefs(false)).not.toContain(h);
    expect(hrefs(false)).toContain('/transactions/new');
    expect(hrefs(false)).toContain('/settings/password');
  });

  it('URL を直接開かれても、連携系のページは案内だけを出す', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of [
      'app/(app)/settings/gmail/page.tsx',
      'app/(app)/settings/google/page.tsx',
      'app/(app)/settings/rescued-emails/page.tsx',
      'app/(app)/briefs/page.tsx',
      'app/(app)/debts/layout.tsx', // /debts 配下のすべての画面
    ]) {
      expect(readFileSync(f, 'utf8'), f).toContain('isCurrentUserOwner');
    }
  });

  it('ホームの「完済まで」(借金)の表示は、オーナーだけ。それ以外は確認の連続日数だけ', async () => {
    const { readFileSync } = await import('node:fs');
    const home = readFileSync('app/(app)/page.tsx', 'utf8');
    expect(home).toContain('isCurrentUserOwner');
    expect(home).toMatch(/\{isOwner \? \(/);
  });
});
