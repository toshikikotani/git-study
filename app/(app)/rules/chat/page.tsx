'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

/**
 * ルールをAIに相談する(新機能、ADR-022)。
 *
 * 「スターバックスは浪費にして」のように話すと、分類ルールの作成・変更・
 * 削除を代わりに行う。リボ払い・キャッシング・分割払いの検知ルールは
 * 会話からは触れない(app/api/rules/chat/route.ts で二重に守っている)。
 *
 * 会話はこの画面を離れると消える(サーバー側に保存しない設計)。
 */

type Role = 'user' | 'assistant';
type RuleChange = { kind: 'created' | 'updated' | 'deleted'; ruleName: string; detail: string };
type Message = { role: Role; content: string; changes?: RuleChange[] };

const SUGGESTIONS = [
  'スターバックスは浪費カテゴリにして',
  '「Amazon」で始まる明細を投資的支出にして',
  '使っていないルールを整理したい',
];

export default function RulesChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  async function send(text: string) {
    const content = text.trim();
    if (content === '' || sending) return;

    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setInput('');
    setError(null);
    setSending(true);

    try {
      const response = await fetch('/api/rules/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      if (!response.ok) {
        setError('送信に失敗しました。時間をおいて試してください。');
        return;
      }
      const result = (await response.json()) as { reply?: string; changes?: RuleChange[] };
      setMessages([
        ...next,
        { role: 'assistant', content: result.reply ?? '', changes: result.changes ?? [] },
      ]);
    } catch {
      setError('送信に失敗しました。時間をおいて試してください。');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rise flex h-[calc(100dvh-6.5rem)] flex-col">
      <header className="flex items-baseline justify-between gap-3 pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            ルールをAIに相談する
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            話した内容でルールを作成・変更・削除します
          </p>
        </div>
        <Link href="/rules" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          一覧を見る
        </Link>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto pb-3">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <div
              className="rounded-2xl p-4"
              style={{ background: 'var(--accent-track)', boxShadow: 'var(--card-shadow)' }}
            >
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                リボ払い・キャッシング・分割払いの検知ルールには触れません。それ以外のカテゴリ分けの
                ルールを、会話だけで整えられます。
              </p>
            </div>
            <div className="space-y-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="block w-full rounded-2xl px-4 py-3 text-left text-[13px]"
                  style={{
                    background: 'var(--surface)',
                    color: 'var(--ink-secondary)',
                    boxShadow: 'var(--card-shadow)',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => <Bubble key={i} message={m} />)
        )}

        {sending ? (
          <div className="pop-in flex justify-start">
            <div
              className="flex items-center gap-1.5 rounded-2xl rounded-bl-md px-4 py-3"
              style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="typing-dot h-1.5 w-1.5 rounded-full"
                  style={{ background: 'var(--ink-muted)', animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="pop-in text-center text-xs" style={{ color: 'var(--over)' }}>
            {error}
          </p>
        ) : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="flex items-end gap-2 pt-1"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          placeholder="例:コンビニの明細は生活費にして"
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl px-4 py-2.5 text-sm outline-none"
          style={{
            background: 'var(--surface)',
            color: 'var(--ink)',
            boxShadow: 'var(--card-shadow)',
          }}
        />
        <button
          type="submit"
          disabled={sending || input.trim() === ''}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
          aria-label="送信"
        >
          →
        </button>
      </form>
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  return (
    <div className={`pop-in flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[85%] space-y-2">
        <div
          className={`px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap ${
            isUser ? 'rounded-2xl rounded-br-md' : 'rounded-2xl rounded-bl-md'
          }`}
          style={
            isUser
              ? { background: 'var(--accent)', color: '#fff' }
              : {
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  boxShadow: 'var(--card-shadow)',
                }
          }
        >
          {message.content}
        </div>

        {message.changes && message.changes.length > 0 ? (
          <ul className="space-y-1 rounded-2xl px-3 py-2" style={{ background: 'var(--plane)' }}>
            {message.changes.map((c, i) => (
              <li key={i} className="flex items-baseline gap-2 text-[12px]">
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={changeBadgeStyle(c.kind)}
                >
                  {changeLabel(c.kind)}
                </span>
                <span style={{ color: 'var(--ink-secondary)' }}>
                  {c.ruleName}
                  {c.detail ? (
                    <span style={{ color: 'var(--ink-muted)' }}> — {c.detail}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function changeLabel(kind: RuleChange['kind']): string {
  switch (kind) {
    case 'created':
      return '作成';
    case 'updated':
      return '変更';
    case 'deleted':
      return '削除';
  }
}

function changeBadgeStyle(kind: RuleChange['kind']): React.CSSProperties {
  if (kind === 'deleted') return { background: 'var(--over-track)', color: 'var(--over)' };
  if (kind === 'created') return { background: 'var(--accent-track)', color: 'var(--income)' };
  return { background: 'var(--accent-track)', color: 'var(--accent)' };
}
