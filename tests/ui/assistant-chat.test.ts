import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('../../app/(app)/refresh-actions', () => ({ refreshAllAction: vi.fn() }));

import { AssistantChat } from '../../app/(app)/assistant/assistant-chat';

const visible = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ');

describe('AIの窓口:下のAIボタンから開くシート(ADR-103)', () => {
  const raw = renderToString(
    h(AssistantChat, { variant: 'sheet', onClose: () => {}, onNavigate: () => {} }),
  );
  const text = visible(raw);

  it('題は「AI」。閉じる・新しい会話がある', () => {
    expect(text).toContain('AI');
    expect(text).toContain('閉じる');
    expect(text).toContain('新しい会話');
  });

  it('記録・質問・変更・画面の案内まで頼めること、反映は確認してからであることを書く', () => {
    expect(text).toContain('記録・質問・設定の変更・画面の案内');
    expect(text).toContain('確認カードで「反映」を押すまで行いません');
    expect(text).toContain('コンビニで500円使った');
  });

  it('話しかける欄と送るボタン(文字の自動入力は止める)', () => {
    expect(raw).toContain('aria-label="送る"');
    expect(raw).toMatch(/<textarea[^>]*autoComplete="off"/i);
  });
});

describe('どこからでも開ける:下のメニューにAIボタン(ADR-103)', () => {
  const shell = readFileSync('app/(app)/app-shell.tsx', 'utf8');

  it('ボトムバーにAIのボタンがあり、シートで AssistantChat を開く', () => {
    expect(shell).toContain('<AiIcon />');
    expect(shell).toContain('onClick={() => setAiOpen(true)}');
    expect(shell).toMatch(/<BottomSheet open=\{aiOpen\}[\s\S]*?<AssistantChat/);
  });

  it('画面へのボタンを押したら、シートを閉じてその画面へ移る', () => {
    expect(shell).toMatch(/onNavigate=\{\(href\) => \{\s*setAiOpen\(false\);/);
  });
});
