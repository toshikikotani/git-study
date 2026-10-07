'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import type { AssistantChange } from '@/features/assistant/chat-tools';
import type { AskUserQuestion, ProposedChange } from '@/features/assistant/plan';

/**
 * AIの窓口(本人発案「AIの口を一つにして、ユーザーの意見によってさまざまな設定値を
 * オーケストラ的に変更する」「対話型のUIを出せない?」、ADR-054 → ADR-059)。
 *
 * 設定・明細・ジャンル予算・目標・支出目標・レシート品目の変更と、買う前の相談を、
 * この1画面の会話で行う。AIの変更案は、勝手に反映せずチャット内の確認カードに出す
 * (項目ごとにオフにでき、承認した分だけがまとめて反映される)。方針が分かれるときは
 * 選択肢のチップを出し、タップした文言が次の発言になる。
 *
 * 会話はこの画面を離れると消える(サーバー側に保存しない設計)。
 */

type Role = 'user' | 'assistant';
type ProposalStatus = 'pending' | 'applying' | 'applied' | 'cancelled';
type ApplyResult =
  { ok: true; change: AssistantChange } | { ok: false; target: string; error: string };

type Message = {
  role: Role;
  content: string;
  question?: AskUserQuestion;
  /** 選択肢を選び終えたか(選び終えたら押せなくする)。 */
  answered?: boolean;
  proposal?: {
    changes: ProposedChange[];
    /** 承認対象として残す項目(チェックが入っているもの)。 */
    selected: boolean[];
    status: ProposalStatus;
    results?: ApplyResult[];
  };
};

const SUGGESTIONS = [
  '食費をもう少し抑えたい',
  '給料日を20日にして、毎月の貯金目標を8万円にしたい',
  '旅行のために貯金したい',
  'これを買おうか迷っている',
];

export default function AssistantChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  function patchMessage(index: number, patch: Partial<Message>) {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  async function send(text: string, base: Message[] = messages) {
    const content = text.trim();
    if (content === '' || sending) return;

    const next: Message[] = [...base, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setError(null);
    setSending(true);

    try {
      const response = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      if (!response.ok) {
        setError('送信に失敗しました。時間をおいて試してください。');
        return;
      }
      const result = (await response.json()) as {
        reply?: string;
        proposal?: { changes: ProposedChange[] } | null;
        question?: AskUserQuestion | null;
      };
      const changes = result.proposal?.changes ?? [];
      setMessages([
        ...next,
        {
          role: 'assistant',
          content: result.reply ?? '',
          ...(result.question ? { question: result.question } : {}),
          ...(changes.length > 0
            ? {
                proposal: {
                  changes,
                  selected: changes.map(() => true),
                  status: 'pending' as const,
                },
              }
            : {}),
        },
      ]);
    } catch {
      setError('送信に失敗しました。時間をおいて試してください。');
    } finally {
      setSending(false);
    }
  }

  function answerQuestion(index: number, labels: string[]) {
    if (labels.length === 0) return;
    const base = messages.map((m, i) => (i === index ? { ...m, answered: true } : m));
    void send(labels.join('、'), base);
  }

  function toggleChange(index: number, changeIndex: number) {
    setMessages((prev) =>
      prev.map((m, i) => {
        if (i !== index || !m.proposal || m.proposal.status !== 'pending') return m;
        const selected = m.proposal.selected.map((v, j) => (j === changeIndex ? !v : v));
        return { ...m, proposal: { ...m.proposal, selected } };
      }),
    );
  }

  async function applyProposal(index: number) {
    const proposal = messages[index]?.proposal;
    if (!proposal || proposal.status !== 'pending') return;
    const chosen = proposal.changes.filter((_, i) => proposal.selected[i]);
    if (chosen.length === 0) return;

    patchMessage(index, { proposal: { ...proposal, status: 'applying' } });
    try {
      const response = await fetch('/api/assistant/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ changes: chosen.map(({ tool, input }) => ({ tool, input })) }),
      });
      if (!response.ok) {
        patchMessage(index, { proposal: { ...proposal, status: 'pending' } });
        setError('反映に失敗しました。時間をおいて試してください。');
        return;
      }
      const { results } = (await response.json()) as { results: ApplyResult[] };
      patchMessage(index, { proposal: { ...proposal, status: 'applied', results } });
      const okCount = results.filter((r) => r.ok).length;
      const failCount = results.length - okCount;
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            failCount === 0
              ? `${okCount}件の変更を反映しました。`
              : `${okCount}件を反映しました。${failCount}件は反映できませんでした。`,
        },
      ]);
    } catch {
      patchMessage(index, { proposal: { ...proposal, status: 'pending' } });
      setError('反映に失敗しました。時間をおいて試してください。');
    }
  }

  function cancelProposal(index: number) {
    const proposal = messages[index]?.proposal;
    if (!proposal || proposal.status !== 'pending') return;
    patchMessage(index, { proposal: { ...proposal, status: 'cancelled' } });
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: '変更案は反映しませんでした。別の案があれば教えてください。' },
    ]);
  }

  return (
    <div className="rise flex h-[calc(100dvh-9.5rem)] flex-col">
      <header className="flex items-baseline justify-between gap-3 pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            AIに相談
          </h1>
          <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            意見を話すと、必要な設定をまとめて変更案にします
          </p>
        </div>
        <Link href="/savings" className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          貯金目標
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
                「食費を抑えたい」のような意見から、月次予算・支出目標・設定などをまとめて
                変更案にします。反映は確認カードで承認したものだけ。削除や口座・負債・
                秘匿情報、リボ払い等の検知には触れません。
              </p>
            </div>
            <div className="space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="block w-full rounded-2xl px-4 py-3 text-left text-xs"
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
          messages.map((m, i) => (
            <Bubble
              key={i}
              message={m}
              busy={sending}
              onAnswer={(labels) => answerQuestion(i, labels)}
              onToggle={(changeIndex) => toggleChange(i, changeIndex)}
              onApply={() => void applyProposal(i)}
              onCancel={() => cancelProposal(i)}
            />
          ))
        )}

        {sending ? (
          <div className="pop-in flex justify-start">
            <div
              className="flex items-center gap-2 rounded-2xl rounded-bl-md px-4 py-3"
              style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="typing-dot h-2 w-2 rounded-full"
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
          placeholder="例:食費をもう少し抑えたい"
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl px-4 py-3 text-sm outline-none"
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
          style={{ background: 'var(--action)' }}
          aria-label="送信"
        >
          →
        </button>
      </form>
    </div>
  );
}

function Bubble({
  message,
  busy,
  onAnswer,
  onToggle,
  onApply,
  onCancel,
}: {
  message: Message;
  busy: boolean;
  onAnswer: (labels: string[]) => void;
  onToggle: (changeIndex: number) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const isUser = message.role === 'user';
  return (
    <div className={`pop-in flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[92%] space-y-2">
        <div
          className={`px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
            isUser ? 'rounded-2xl rounded-br-md' : 'rounded-2xl rounded-bl-md'
          }`}
          style={
            isUser
              ? { background: 'var(--accent)', color: 'var(--on-accent)' }
              : {
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  boxShadow: 'var(--card-shadow)',
                }
          }
        >
          {message.content}
        </div>

        {message.question ? (
          <QuestionCard
            question={message.question}
            disabled={busy || message.answered === true}
            onAnswer={onAnswer}
          />
        ) : null}

        {message.proposal ? (
          <ProposalCard
            proposal={message.proposal}
            onToggle={onToggle}
            onApply={onApply}
            onCancel={onCancel}
          />
        ) : null}
      </div>
    </div>
  );
}

function QuestionCard({
  question,
  disabled,
  onAnswer,
}: {
  question: AskUserQuestion;
  disabled: boolean;
  onAnswer: (labels: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);

  function tap(label: string) {
    if (disabled) return;
    if (!question.multiSelect) {
      onAnswer([label]);
      return;
    }
    setPicked((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );
  }

  return (
    <div
      className="space-y-2 rounded-2xl p-3"
      style={{ background: 'var(--plane)', opacity: disabled ? 0.6 : 1 }}
    >
      <p className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
        {question.question}
      </p>
      <div className="space-y-2">
        {question.options.map((option) => {
          const isPicked = picked.includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              disabled={disabled}
              onClick={() => tap(option.label)}
              className="block w-full rounded-xl px-3 py-2 text-left"
              style={{
                background: isPicked ? 'var(--accent-track)' : 'var(--surface)',
                boxShadow: 'var(--card-shadow)',
                outline: isPicked ? '2px solid var(--accent)' : 'none',
              }}
            >
              <span className="block text-xs font-medium" style={{ color: 'var(--ink)' }}>
                {option.label}
              </span>
              {option.description ? (
                <span className="block text-xs" style={{ color: 'var(--ink-muted)' }}>
                  {option.description}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {question.multiSelect ? (
        <button
          type="button"
          disabled={disabled || picked.length === 0}
          onClick={() => onAnswer(picked)}
          className="w-full rounded-xl py-2 text-xs font-semibold text-white disabled:opacity-40"
          style={{ background: 'var(--action)' }}
        >
          この内容で決める
        </button>
      ) : null}
    </div>
  );
}

function ProposalCard({
  proposal,
  onToggle,
  onApply,
  onCancel,
}: {
  proposal: NonNullable<Message['proposal']>;
  onToggle: (changeIndex: number) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const { changes, selected, status, results } = proposal;
  const selectedCount = selected.filter(Boolean).length;
  const locked = status !== 'pending';

  if (status === 'applied' && results) {
    return (
      <ul className="space-y-1 rounded-2xl px-3 py-2" style={{ background: 'var(--plane)' }}>
        {results.map((r, i) =>
          r.ok ? (
            <li key={i} className="flex items-baseline gap-2 text-xs">
              <span
                className="shrink-0 rounded-full px-2 py-1 text-xs font-semibold"
                style={changeBadgeStyle(r.change.kind)}
              >
                {changeLabel(r.change.kind)}
              </span>
              <span style={{ color: 'var(--ink-secondary)' }}>
                {r.change.target}
                <span style={{ color: 'var(--ink-muted)' }}> — {r.change.detail}</span>
              </span>
            </li>
          ) : (
            <li key={i} className="text-xs" style={{ color: 'var(--over)' }}>
              {r.target} — {r.error}
            </li>
          ),
        )}
      </ul>
    );
  }

  return (
    <div
      className="space-y-2 rounded-2xl p-3"
      style={{ background: 'var(--plane)', opacity: status === 'cancelled' ? 0.5 : 1 }}
    >
      <p className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
        変更案({changes.length}件)— 反映したいものにチェック
      </p>
      <ul className="space-y-2">
        {changes.map((c, i) => (
          <li key={i}>
            <label
              className="flex items-start gap-2 rounded-xl px-3 py-2"
              style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
            >
              <input
                type="checkbox"
                checked={selected[i] ?? false}
                disabled={locked}
                onChange={() => onToggle(i)}
                className="mt-1"
              />
              <span className="min-w-0 text-xs" style={{ color: 'var(--ink-secondary)' }}>
                <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                  {c.target}
                </span>
                <span className="block" style={{ color: 'var(--ink-muted)' }}>
                  {c.detail}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {status === 'cancelled' ? null : (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={locked || selectedCount === 0}
            onClick={onApply}
            className="flex-1 rounded-xl py-2 text-xs font-semibold text-white disabled:opacity-40"
            style={{ background: 'var(--action)' }}
          >
            {status === 'applying' ? '反映しています…' : `${selectedCount}件をまとめて反映`}
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-xs disabled:opacity-40"
            style={{ background: 'var(--surface)', color: 'var(--ink-secondary)' }}
          >
            やめる
          </button>
        </div>
      )}
    </div>
  );
}

function changeLabel(kind: AssistantChange['kind']): string {
  switch (kind) {
    case 'created':
      return '作成';
    case 'updated':
      return '変更';
    case 'deleted':
      return '削除';
  }
}

function changeBadgeStyle(kind: AssistantChange['kind']): React.CSSProperties {
  if (kind === 'deleted') return { background: 'var(--over-track)', color: 'var(--over)' };
  if (kind === 'created') return { background: 'var(--accent-track)', color: 'var(--income)' };
  return { background: 'var(--accent-track)', color: 'var(--accent)' };
}
