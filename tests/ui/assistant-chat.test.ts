import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('../../app/(app)/refresh-actions', () => ({ refreshAllAction: vi.fn() }));

import { AssistantChat, Bubble } from '../../app/(app)/assistant/assistant-chat';
import {
  editRecord,
  readChat,
  resetChat,
  retry,
  send,
  type Message,
} from '../../app/(app)/assistant/chat-store';

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

const noop = () => {};
const bubble = (message: Message) =>
  visible(
    renderToString(
      h(Bubble, {
        message,
        busy: false,
        onRetry: noop,
        onAnswer: noop,
        onToggle: noop,
        onEdit: noop,
        onApply: noop,
        onCancel: noop,
        onGo: noop,
      }),
    ),
  );

const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('送れなかった発言は、もう一度送れる(ADR-105)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetChat();
  });

  it('電波が無くて送れなかったら、発言に理由をつけて残す(返事待ちのままにしない)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    await send('コンビニで500円');
    const { messages, sending } = readChat();
    expect(sending).toBe(false);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'コンビニで500円' });
    expect(messages[0]!.failed).toContain('もう一度送ってください');
  });

  it('AIの呼び出しに失敗したら、サーバーの理由を出す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => reply({ error: 'AIの呼び出しが混み合っています。' }, 429)),
    );
    await send('今月はあといくら？');
    expect(readChat().messages[0]!.failed).toBe('AIの呼び出しが混み合っています。');
  });

  it('「もう一度送る」は同じ発言をそのまま送り直す(発言を2つにしない)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    await send('コンビニで500円');
    const fetchMock = vi.fn<typeof fetch>(() =>
      reply({ reply: '案を作りました。', proposal: null, question: null }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await retry();
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages).toEqual([{ role: 'user', content: 'コンビニで500円' }]);
    const { messages } = readChat();
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0]!.failed).toBeUndefined();
  });

  it('送れなかったまま次を送ったら、送れなかった発言もいっしょに送る', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    await send('コンビニで500円');
    const fetchMock = vi.fn<typeof fetch>(() =>
      reply({ reply: 'わかりました。', proposal: null, question: null }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await send('あと昼に1000円');
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as {
      messages: { content: string }[];
    };
    expect(body.messages.map((m) => m.content)).toEqual(['コンビニで500円', 'あと昼に1000円']);
    expect(readChat().messages.some((m) => m.failed !== undefined)).toBe(false);
  });

  it('送れなかった発言の下に、理由と「もう一度送る」を出す', () => {
    const text = bubble({ role: 'user', content: 'コンビニで500円', failed: '送れませんでした。' });
    expect(text).toContain('送れませんでした。');
    expect(text).toContain('もう一度送る');
    expect(bubble({ role: 'user', content: 'コンビニで500円' })).not.toContain('もう一度送る');
  });
});

describe('AIが出した記録の案は「直す」で直せる(ADR-105)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetChat();
  });

  const record = {
    kind: 'expense' as const,
    amountYen: 500,
    genreId: 'g-food',
    genreName: '食料品',
    date: '2026-10-16',
    name: 'セブン',
    memo: '',
  };
  const proposalMessage = (status: 'pending' | 'cancelled'): Message => ({
    role: 'assistant',
    content: '案を作りました。',
    proposal: {
      changes: [
        {
          tool: 'add_transaction',
          input: {},
          kind: 'created',
          target: 'セブン',
          detail: '10月16日 支出 500円 · 食料品',
          record,
        },
        {
          tool: 'update_genre_budget',
          input: {},
          kind: 'updated',
          target: '外食',
          detail: '月次予算: 無制限→1万円',
        },
      ],
      selected: [true, true],
      status,
    },
  });

  it('記録の案にだけ「直す」が出る(反映済み・やめた案には出ない)', () => {
    const text = bubble(proposalMessage('pending'));
    expect(text).toContain('直す');
    expect(text.match(/直す/g)).toHaveLength(1);
    expect(bubble(proposalMessage('cancelled'))).not.toContain('直す');
  });

  it('直した中身で確認カードの文言と送る入力を作り直し、チェックを入れる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        reply({
          reply: '案を作りました。',
          proposal: { changes: proposalMessage('pending').proposal!.changes },
          question: null,
        }),
      ),
    );
    await send('セブンで500円');
    const index = readChat().messages.length - 1;
    editRecord(index, 0, { ...record, amountYen: 1200, name: 'ローソン', memo: 'お茶' });
    const proposal = readChat().messages[index]!.proposal!;
    expect(proposal.changes[0]).toMatchObject({
      target: 'ローソン',
      input: {
        occurred_on: '2026-10-16',
        amount_yen: 1200,
        kind: 'expense',
        store_name: 'ローソン',
        genre_name: '食料品',
        memo: 'お茶',
      },
    });
    expect(proposal.changes[0]!.detail).toContain('1,200円');
    expect(proposal.changes[1]!.target).toBe('外食');
    expect(proposal.selected).toEqual([true, true]);
  });

  it('直す画面は「記録する」と同じ部品で、右上は「完了」。反映を押すまで記録しないと書く', () => {
    const chatSource = readFileSync('app/(app)/assistant/assistant-chat.tsx', 'utf8');
    expect(chatSource).toMatch(/<RecordSheet[\s\S]*?saveLabel: '完了'/);
    expect(chatSource).toContain('記録されるのは、カードの「反映」を押したときです。');
    const sheetSource = readFileSync('app/(app)/record-sheet.tsx', 'utf8');
    expect(sheetSource).toContain("{edit?.saveLabel ?? '保存'}");
  });
});
