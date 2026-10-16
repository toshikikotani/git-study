'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { AskUserQuestion } from '@/features/assistant/plan';
import { recordFromEdit } from '@/features/assistant/record-change';
import { useSpeechInput } from '@/lib/speech-input';
import { RecordSheet } from '../record-sheet';
import { refreshAllAction } from '../refresh-actions';
import {
  answerQuestion,
  applyProposal,
  cancelProposal,
  editRecord,
  resetChat,
  retry,
  send,
  toggleChange,
  useChat,
  type Message,
} from './chat-store';

/**
 * AIの窓口(ADR-054 → 059 → 103)。下のAIボタンから、どの画面でもシートで開く(/assistant でも同じ部品)。
 * 記録・質問への答え・設定の変更・画面の案内まで、会話で頼める。声でも話しかけられる(マイク)。
 * 登録・変更は勝手にしない:AIの案は確認カードに出し、本人が反映を押したものだけを反映する。
 * 会話で出せないものは、その画面へのボタン(show_screen)を出す。
 * 会話はアプリを開いているあいだ残る(シートを閉じても続きから。返事を待つあいだに閉じても消えない)。
 * 送れなかった発言には「もう一度送る」を出す。AIが出した記録の案は「直す」で、記録すると同じ画面で直せる
 * (ADR-105)。
 */

const SUGGESTIONS = [
  'コンビニで500円使った',
  '今月はあといくら使える？',
  '食費をもう少し抑えたい',
  '固定費を見直したい',
];

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
  /** 直している記録の案(どの発言の、何件目か)。 */
  const [editing, setEditing] = useState<{ message: number; change: number } | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, editing]);

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

  // AIが出した記録の案を直す:記録すると同じ画面にして、「完了」で確認カードに戻す(ADR-105)。
  const editingProposal = editing ? messages[editing.message]?.proposal : undefined;
  const editingRecord =
    editing && editingProposal?.status === 'pending'
      ? editingProposal.changes[editing.change]?.record
      : undefined;
  if (editing && editingRecord) {
    const target = editing;
    const before = editingRecord;
    return (
      <div className={variant === 'sheet' ? 'min-h-[84dvh]' : 'rise'}>
        <RecordSheet
          key={`${target.message}-${target.change}`}
          onClose={() => setEditing(null)}
          onFiles={() => {}}
          edit={{
            initial: {
              kind: before.kind,
              amountYen: before.amountYen,
              genreId: before.genreId,
              date: before.date,
              name: before.name,
              memo: before.memo,
            },
            saveLabel: '完了',
            onSave: (values, genreName) =>
              editRecord(target.message, target.change, recordFromEdit(before, values, genreName)),
            footer: (
              <p className="px-3 text-[12px] leading-normal" style={{ color: 'var(--ink-muted)' }}>
                「完了」で確認カードに戻ります。記録されるのは、カードの「反映」を押したときです。
              </p>
            ),
          }}
        />
      </div>
    );
  }

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
              onRetry={() => void retry()}
              onAnswer={(labels) => answerQuestion(i, labels)}
              onToggle={(changeIndex) => toggleChange(i, changeIndex)}
              onEdit={(changeIndex) => setEditing({ message: i, change: changeIndex })}
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

/** 発言1つ(送れなかった発言の「もう一度送る」、選択肢、確認カード、画面へのボタンを含む)。 */
export function Bubble({
  message,
  busy,
  onRetry,
  onAnswer,
  onToggle,
  onEdit,
  onApply,
  onCancel,
  onGo,
}: {
  message: Message;
  busy: boolean;
  onRetry: () => void;
  onAnswer: (labels: string[]) => void;
  onToggle: (changeIndex: number) => void;
  onEdit: (changeIndex: number) => void;
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
              ? {
                  background: 'var(--accent)',
                  color: 'var(--on-accent)',
                  opacity: message.failed ? 0.6 : 1,
                }
              : { background: 'var(--surface)', color: 'var(--ink)' }
          }
        >
          {message.content}
        </div>

        {/* 送れなかった発言:理由と「もう一度送る」(同じ発言をそのまま送り直す、ADR-105) */}
        {message.failed ? (
          <div className="flex flex-col items-end gap-1">
            <p
              role="alert"
              className="line-clamp-2 text-right text-[13px]"
              style={{ color: 'var(--over)' }}
            >
              {message.failed}
            </p>
            <button
              type="button"
              onClick={onRetry}
              disabled={busy}
              className="flex min-h-11 items-center gap-2 rounded-full px-4 text-[14px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--plane)', color: 'var(--accent)' }}
            >
              <RetryIcon />
              もう一度送る
            </button>
          </div>
        ) : null}

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
            onEdit={onEdit}
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
  onEdit,
  onApply,
  onCancel,
}: {
  proposal: NonNullable<Message['proposal']>;
  onToggle: (changeIndex: number) => void;
  /** 記録の案を直す(記録すると同じ画面で、ADR-105)。 */
  onEdit: (changeIndex: number) => void;
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
          <li
            key={i}
            className="flex items-stretch rounded-xl"
            style={{ background: 'var(--surface)' }}
          >
            <label className="flex min-h-11 min-w-0 flex-1 items-start gap-3 px-3 py-2">
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
            {/* AIが出した記録の案は、記録すると同じ画面で直せる(金額・日付・名前・カテゴリ・メモ) */}
            {c.record && !locked ? (
              <button
                type="button"
                onClick={() => onEdit(i)}
                aria-label={`${c.target}を直す`}
                className="flex min-h-11 shrink-0 items-center px-3 text-[14px] font-semibold"
                style={{ color: 'var(--accent)' }}
              >
                直す
              </button>
            ) : null}
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

function RetryIcon() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" />
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
