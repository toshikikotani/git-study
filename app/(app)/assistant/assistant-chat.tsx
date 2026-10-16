'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { AssistantChange } from '@/features/assistant/chat-tools';
import type { AskUserQuestion, ProposedChange } from '@/features/assistant/plan';
import type { ScreenLink } from '@/features/assistant/screens';
import { hapticFor } from '@/lib/haptics';
import { useSpeechInput } from '@/lib/speech-input';
import { refreshAllAction } from '../refresh-actions';

/**
 * AIの窓口(ADR-054 → 059 → 103)。下のAIボタンから、どの画面でもシートで開く(/assistant でも同じ部品)。
 * 記録・質問への答え・設定の変更・画面の案内まで、会話で頼める。声でも話しかけられる(マイク)。
 * 登録・変更は勝手にしない:AIの案は確認カードに出し、本人が反映を押したものだけを反映する。
 * 会話で出せないものは、その画面へのボタン(show_screen)を出す。
 * 会話はアプリを開いているあいだ残る(シートを閉じても続きから。返事を待つあいだに閉じても消えない)。
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
    /** 反映する項目(チェックが入っているもの)。 */
    selected: boolean[];
    status: ProposalStatus;
    results?: ApplyResult[];
  };
  /** 画面へ移るボタン。 */
  links?: ScreenLink[];
};

const SUGGESTIONS = [
  'コンビニで500円使った',
  '今月はあといくら使える？',
  '食費をもう少し抑えたい',
  '固定費を見直したい',
];

// ---- 会話(アプリを開いているあいだ残す。シートを閉じても、返事を待つあいだに閉じても続く)--------
type ChatState = { messages: Message[]; sending: boolean; error: string | null };
const INITIAL: ChatState = { messages: [], sending: false, error: null };
let chat: ChatState = INITIAL;
const listeners = new Set<() => void>();

function update(patch: (s: ChatState) => Partial<ChatState>): void {
  chat = { ...chat, ...patch(chat) };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useChat(): ChatState {
  return useSyncExternalStore(
    subscribe,
    () => chat,
    () => INITIAL,
  );
}

function patchMessage(index: number, patch: Partial<Message>): void {
  update((s) => ({ messages: s.messages.map((m, i) => (i === index ? { ...m, ...patch } : m)) }));
}

async function send(text: string, base?: Message[]): Promise<void> {
  const content = text.trim();
  if (content === '' || chat.sending) return;
  const next: Message[] = [...(base ?? chat.messages), { role: 'user', content }];
  update(() => ({ messages: next, sending: true, error: null }));
  try {
    const response = await fetch('/api/assistant/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
    });
    if (!response.ok) {
      update(() => ({ error: '送れませんでした。もう一度送ってください。' }));
      return;
    }
    const result = (await response.json()) as {
      reply?: string;
      proposal?: { changes: ProposedChange[] } | null;
      question?: AskUserQuestion | null;
      links?: ScreenLink[];
    };
    const changes = result.proposal?.changes ?? [];
    const links = result.links ?? [];
    update((s) => ({
      messages: [
        ...s.messages,
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
          ...(links.length > 0 ? { links } : {}),
        },
      ],
    }));
  } catch {
    update(() => ({ error: '送れませんでした。電波のよい所で、もう一度送ってください。' }));
  } finally {
    update(() => ({ sending: false }));
  }
}

async function applyProposal(index: number, onApplied: () => void): Promise<void> {
  const proposal = chat.messages[index]?.proposal;
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
      update(() => ({ error: '反映できませんでした。もう一度「反映」を押してください。' }));
      return;
    }
    const { results } = (await response.json()) as { results: ApplyResult[] };
    patchMessage(index, { proposal: { ...proposal, status: 'applied', results } });
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    update((s) => ({
      messages: [
        ...s.messages,
        {
          role: 'assistant',
          content:
            failCount === 0
              ? `${okCount}件を反映しました。`
              : `${okCount}件を反映しました。${failCount}件は反映できませんでした。`,
        },
      ],
    }));
    if (okCount > 0) {
      hapticFor('save');
      onApplied();
    }
  } catch {
    patchMessage(index, { proposal: { ...proposal, status: 'pending' } });
    update(() => ({ error: '反映できませんでした。電波のよい所で、もう一度押してください。' }));
  }
}

function cancelProposal(index: number): void {
  const proposal = chat.messages[index]?.proposal;
  if (!proposal || proposal.status !== 'pending') return;
  patchMessage(index, { proposal: { ...proposal, status: 'cancelled' } });
  update((s) => ({
    messages: [
      ...s.messages,
      { role: 'assistant', content: '反映しませんでした。直したいところがあれば教えてください。' },
    ],
  }));
}

function toggleChange(index: number, changeIndex: number): void {
  const m = chat.messages[index];
  if (!m?.proposal || m.proposal.status !== 'pending') return;
  const selected = m.proposal.selected.map((v, j) => (j === changeIndex ? !v : v));
  patchMessage(index, { proposal: { ...m.proposal, selected } });
}

function answerQuestion(index: number, labels: string[]): void {
  if (labels.length === 0) return;
  const base = chat.messages.map((m, i) => (i === index ? { ...m, answered: true } : m));
  void send(labels.join('、'), base);
}

/** 会話を初めからにする。 */
function resetChat(): void {
  if (chat.sending) return;
  update(() => INITIAL);
}

export function AssistantChat({
  variant,
  onClose,
  onNavigate,
}: {
  /** sheet:下のAIボタンから開くシート / page:/assistant の画面。 */
  variant: 'sheet' | 'page';
  onClose?: () => void;
  /** 画面へのボタンを押したとき(シートを閉じて移る)。 */
  onNavigate?: (href: string) => void;
}) {
  const router = useRouter();
  const { messages, sending, error } = useChat();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const speech = useSpeechInput((text) => void send(text));

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const submit = () => {
    if (input.trim() === '' || sending) return;
    void send(input);
    setInput('');
  };
  const go = (href: string) => {
    if (onNavigate) onNavigate(href);
    else router.push(href as never);
  };
  // 反映したら、どの画面も最新にする(AIの反映はルートハンドラーで書くので、画面の作り置きを消す)。
  const applied = () => {
    void refreshAllAction().then(() => router.refresh());
  };

  return (
    <div
      className={
        variant === 'sheet'
          ? 'flex h-[84dvh] flex-col gap-2'
          : 'rise flex h-[calc(100dvh-9.5rem)] flex-col gap-2'
      }
      style={{ color: 'var(--ink)' }}
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <button
          type="button"
          onClick={resetChat}
          disabled={sending || messages.length === 0}
          className="flex min-h-11 items-center justify-self-start text-[15px] disabled:opacity-40"
          style={{ color: 'var(--accent)' }}
        >
          新しい会話
        </button>
        <span className="text-[17px] font-semibold">AI</span>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 items-center justify-self-end text-[17px] font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            閉じる
          </button>
        ) : (
          <span />
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto overscroll-contain pb-2">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p
              className="rounded-2xl px-4 py-3 text-[14px] leading-relaxed"
              style={{ background: 'var(--surface)', color: 'var(--ink-secondary)' }}
            >
              記録・質問・設定の変更・画面の案内まで、話しかけるだけでできます。マイクで声でも。
              記録や変更は、確認カードで「反映」を押すまで行いません。
            </p>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="min-h-11 rounded-2xl px-4 py-3 text-left text-[15px]"
                  style={{ background: 'var(--surface)', color: 'var(--ink)' }}
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
              onApply={() => void applyProposal(i, applied)}
              onCancel={() => cancelProposal(i)}
              onGo={go}
            />
          ))
        )}

        {sending ? (
          <div className="flex justify-start" role="status" aria-label="AIが考えています">
            <div
              className="flex items-center gap-2 rounded-2xl rounded-bl-md px-4 py-3"
              style={{ background: 'var(--surface)' }}
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
          <p role="alert" className="text-center text-[13px]" style={{ color: 'var(--over)' }}>
            {error}
          </p>
        ) : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-end gap-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        {speech.supported ? (
          <button
            type="button"
            onClick={speech.toggle}
            aria-pressed={speech.listening}
            aria-label={speech.listening ? '声の入力を止める' : '声で話しかける'}
            className="flex size-11 shrink-0 items-center justify-center rounded-full"
            style={{
              background: speech.listening ? 'var(--over)' : 'var(--surface)',
              color: speech.listening ? '#fff' : 'var(--accent)',
            }}
          >
            <MicIcon />
          </button>
        ) : null}
        <label className="flex min-w-0 flex-1">
          <span className="sr-only">AIに話しかける</span>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            autoComplete="off"
            placeholder={speech.listening ? '聞いています…' : '例:昨日ランチで1200円'}
            className="max-h-32 min-h-11 w-full resize-none rounded-2xl px-4 py-3 text-[16px] outline-none"
            style={{ background: 'var(--surface)', color: 'var(--ink)' }}
          />
        </label>
        <button
          type="submit"
          disabled={sending || input.trim() === ''}
          aria-label="送る"
          className="flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
          style={{ background: 'var(--action)', color: 'var(--on-action)' }}
        >
          <SendIcon />
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
  onGo,
}: {
  message: Message;
  busy: boolean;
  onAnswer: (labels: string[]) => void;
  onToggle: (changeIndex: number) => void;
  onApply: () => void;
  onCancel: () => void;
  onGo: (href: string) => void;
}) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[92%] space-y-2">
        <div
          className={`px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap ${
            isUser ? 'rounded-2xl rounded-br-md' : 'rounded-2xl rounded-bl-md'
          }`}
          style={
            isUser
              ? { background: 'var(--accent)', color: 'var(--on-accent)' }
              : { background: 'var(--surface)', color: 'var(--ink)' }
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

        {message.links && message.links.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {message.links.map((l) => (
              <button
                key={l.href}
                type="button"
                onClick={() => onGo(l.href)}
                className="flex min-h-11 items-center gap-1 rounded-full px-4 text-[14px] font-semibold"
                style={{ background: 'var(--plane)', color: 'var(--accent)' }}
              >
                {l.label}を開く
                <span aria-hidden>›</span>
              </button>
            ))}
          </div>
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
      <p className="text-[14px] font-semibold">{question.question}</p>
      <div className="space-y-2">
        {question.options.map((option) => {
          const isPicked = picked.includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              disabled={disabled}
              onClick={() => tap(option.label)}
              className="block min-h-11 w-full rounded-xl px-3 py-2 text-left"
              style={{
                background: isPicked ? 'var(--note)' : 'var(--surface)',
                outline: isPicked ? '2px solid var(--accent)' : 'none',
              }}
            >
              <span className="block text-[14px] font-medium">{option.label}</span>
              {option.description ? (
                <span className="block text-[13px]" style={{ color: 'var(--ink-muted)' }}>
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
          className="min-h-11 w-full rounded-xl text-[14px] font-semibold disabled:opacity-40"
          style={{ background: 'var(--action)', color: 'var(--on-action)' }}
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
            <li key={i} className="flex items-baseline gap-2 text-[13px]">
              <span
                className="shrink-0 rounded-full px-2 py-1 text-[12px] font-semibold"
                style={{ background: 'var(--income-track)', color: 'var(--income)' }}
              >
                反映済み
              </span>
              <span style={{ color: 'var(--ink-secondary)' }}>
                {r.change.target}
                <span style={{ color: 'var(--ink-muted)' }}> — {r.change.detail}</span>
              </span>
            </li>
          ) : (
            <li key={i} className="text-[13px]" style={{ color: 'var(--over)' }}>
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
      <p className="text-[14px] font-semibold">確認({changes.length}件)— 反映するものにチェック</p>
      <ul className="space-y-2">
        {changes.map((c, i) => (
          <li key={i}>
            <label
              className="flex min-h-11 items-start gap-3 rounded-xl px-3 py-2"
              style={{ background: 'var(--surface)' }}
            >
              <input
                type="checkbox"
                checked={selected[i] ?? false}
                disabled={locked}
                onChange={() => onToggle(i)}
                className="mt-1 size-5"
              />
              <span className="min-w-0 text-[14px]">
                <span className="font-semibold">{c.target}</span>
                <span className="block text-[13px]" style={{ color: 'var(--ink-muted)' }}>
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
            className="min-h-11 flex-1 rounded-xl text-[15px] font-semibold disabled:opacity-40"
            style={{ background: 'var(--action)', color: 'var(--on-action)' }}
          >
            {status === 'applying' ? '反映しています…' : `${selectedCount}件を反映`}
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={onCancel}
            className="min-h-11 rounded-xl px-4 text-[15px] disabled:opacity-40"
            style={{ background: 'var(--surface)', color: 'var(--ink-secondary)' }}
          >
            やめる
          </button>
        </div>
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      aria-hidden
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      aria-hidden
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />
    </svg>
  );
}
