'use client';

/**
 * AI相談チャット(本人発案)。目標設定・買う前相談の両方をここで扱う
 * (1つの画面にまとめる、という本人の意向)。
 *
 * 会話は画面を離れると消える(サーバー側に履歴を保存しない、まずは
 * 小さく作る判断。TASKS.md 参照)。目標として保存したい内容だけが
 * goals テーブルに残る。
 */

import { useRef, useState, useTransition } from 'react';

import { formatYen } from '@/domain/money';
import type { AdvisorMessage, GoalProposal } from '@/features/advisor/chat';
import { saveGoalAction, sendAdvisorMessageAction } from './actions';

const GREETING: AdvisorMessage = {
  role: 'assistant',
  content:
    '次に目指すことを一緒に考えたり、買おうか迷っているものについて相談できます。何を話しましょうか?',
};

export function ChatPanel() {
  const [messages, setMessages] = useState<AdvisorMessage[]>([GREETING]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<GoalProposal | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [isSending, startSending] = useTransition();
  const [isSaving, startSaving] = useTransition();
  const listEndRef = useRef<HTMLDivElement>(null);

  function handleSend() {
    const content = input.trim();
    if (content === '' || isSending) return;

    const nextMessages = [...messages, { role: 'user' as const, content }];
    setMessages(nextMessages);
    setInput('');
    setError(null);
    setSavedNotice(false);

    startSending(async () => {
      const result = await sendAdvisorMessageAction(nextMessages);
      if (result.error || result.reply === null) {
        setError(result.error ?? 'AIから返答がありませんでした。');
        return;
      }
      setMessages([...nextMessages, { role: 'assistant', content: result.reply }]);
      setProposal(result.goalProposal);
      listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  function handleSaveProposal() {
    if (proposal === null) return;
    startSaving(async () => {
      const result = await saveGoalAction({
        title: proposal.title,
        targetAmountYen: proposal.targetAmountYen,
        targetDate: proposal.targetDate,
        note: null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setProposal(null);
      setSavedNotice(true);
    });
  }

  return (
    <div
      className="flex flex-col rounded-[22px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        AI相談
      </p>

      <div className="mt-3 max-h-[50vh] space-y-3 overflow-y-auto">
        {messages.map((message, index) => (
          <ChatBubble key={index} message={message} />
        ))}
        {isSending ? (
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            考えています…
          </p>
        ) : null}
        <div ref={listEndRef} />
      </div>

      {proposal ? (
        <GoalProposalCard
          proposal={proposal}
          isSaving={isSaving}
          onSave={handleSaveProposal}
          onDismiss={() => setProposal(null)}
        />
      ) : null}

      {savedNotice ? (
        <p
          className="mt-3 rounded-full px-3 py-1.5 text-center text-xs font-medium"
          style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
        >
          目標として保存しました
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="例:半年後に旅行に行きたい / 3万円のイヤホンを買おうか迷っている"
          rows={2}
          className="flex-1 resize-none rounded-2xl px-3 py-2 text-sm"
          style={{ background: 'var(--plane)', color: 'var(--ink)' }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={isSending || input.trim() === ''}
          className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          送る
        </button>
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: AdvisorMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <p
        className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
        style={{
          background: isUser ? 'var(--accent)' : 'var(--plane)',
          color: isUser ? '#fff' : 'var(--ink)',
        }}
      >
        {message.content}
      </p>
    </div>
  );
}

/** 目標の提案。保存前に本人が内容を確認できるようにする(AIが決めない)。 */
function GoalProposalCard({
  proposal,
  isSaving,
  onSave,
  onDismiss,
}: {
  proposal: GoalProposal;
  isSaving: boolean;
  onSave: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="mt-3 rounded-2xl p-4"
      style={{ background: 'var(--plane)', border: '1px solid var(--hairline)' }}
    >
      <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
        目標の提案
      </p>
      <p className="mt-1 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        {proposal.title}
      </p>
      <p className="tabular mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
        {proposal.targetAmountYen === null ? '金額の目標なし' : formatYen(proposal.targetAmountYen)}
        {proposal.targetDate ? ` / 期限 ${proposal.targetDate}` : ''}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="rounded-full px-3.5 py-1.5 text-xs font-semibold disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          この目標を保存する
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={isSaving}
          className="rounded-full px-3.5 py-1.5 text-xs disabled:opacity-50"
          style={{ color: 'var(--ink-muted)' }}
        >
          今は保存しない
        </button>
      </div>
    </div>
  );
}
