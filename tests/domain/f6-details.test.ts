import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { genreBarColor, genreColorVar } from '../../src/domain/genre-style';
import { consumeJustSaved, markJustSaved } from '../../src/lib/just-saved';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('../../app/(app)/plan/actions', () => ({
  deletePlanAction: async () => ({ error: null }),
}));

describe('F6 動きと細部', () => {
  it('バーの色はジャンルの色を灰に寄せて落ち着かせる(アイコン色はそのまま)', () => {
    expect(genreBarColor('外食')).toContain('color-mix');
    expect(genreBarColor('外食')).toContain(genreColorVar('外食'));
    expect(genreBarColor(null)).toContain('--genre-none');
  });

  describe('保存直後の動きの受け渡し', () => {
    const store = new Map<string, string>();
    beforeEach(() => {
      store.clear();
      vi.stubGlobal('window', {
        sessionStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, v),
          removeItem: (k: string) => void store.delete(k),
        },
      });
    });

    it('保存した id を一度だけ読み出せる', () => {
      markJustSaved(['a', 'b']);
      expect(consumeJustSaved()).toEqual(['a', 'b']);
      expect(consumeJustSaved()).toEqual([]);
    });

    it('壊れた値でも落ちない', () => {
      store.set('ledger:just-saved', '{oops');
      expect(consumeJustSaved()).toEqual([]);
    });
  });

  it('目標の削除ボタンは確認ダイアログの前では削除しない(押すまでシートは出ない)', async () => {
    const { DeletePlanButton } = await import('../../app/(app)/plan/delete-plan-button');
    const html = renderToString(h(DeletePlanButton, { planId: 'p1' }));
    expect(html).toContain('この目標を削除する');
    expect(html).not.toContain('削除しますか');
  });
});
