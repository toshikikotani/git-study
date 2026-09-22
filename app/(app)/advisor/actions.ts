'use server';

/**
 * AI相談画面(/advisor)の Server Action(本人発案)。
 *
 * バリデーションは domain/goals.ts の assertX、店(features/goals/store.ts・
 * features/advisor/*)を呼ぶだけにする(docs/glossary.md「レイヤーの命名」)。
 */

import { revalidatePath } from 'next/cache';

import {
  AdvisorChat,
  AdvisorChatError,
  MAX_HISTORY_MESSAGES,
  type AdvisorMessage,
  type GoalProposal,
} from '@/features/advisor/chat';
import { buildAdvisorContextText } from '@/features/advisor/context';
import {
  abandonGoal,
  createGoal,
  GoalStoreError,
  updateGoalProgress,
  type GoalInput,
} from '@/features/goals/store';
import { apiKeyMissingMessage } from '@/lib/anthropic';
import { readAnthropicApiKey } from '@/lib/env';

export type AdvisorReplyState = {
  error: string | null;
  reply: string | null;
  goalProposal: GoalProposal | null;
};

export async function sendAdvisorMessageAction(
  messages: readonly AdvisorMessage[],
): Promise<AdvisorReplyState> {
  const apiKey = readAnthropicApiKey();
  if (apiKey === null) {
    return {
      error: apiKeyMissingMessage('AI相談'),
      reply: null,
      goalProposal: null,
    };
  }

  // 古い発言が積もりすぎて1回のリクエストが肥大化しないよう、直近だけ送る。
  const recentMessages = messages.slice(-MAX_HISTORY_MESSAGES);

  try {
    const contextText = await buildAdvisorContextText();
    const chat = new AdvisorChat(apiKey);
    const result = await chat.reply(recentMessages, contextText);
    return { error: null, reply: result.reply, goalProposal: result.goalProposal };
  } catch (error) {
    return {
      error: error instanceof AdvisorChatError ? error.message : 'AI相談中にエラーが発生しました。',
      reply: null,
      goalProposal: null,
    };
  }
}

export async function saveGoalAction(input: GoalInput): Promise<{ error: string | null }> {
  try {
    await createGoal(input);
  } catch (error) {
    return {
      error: error instanceof GoalStoreError ? error.message : '目標を保存できませんでした。',
    };
  }
  revalidatePath('/advisor');
  return { error: null };
}

export async function updateGoalProgressAction(
  goalId: string,
  currentAmountYen: number,
): Promise<{ error: string | null }> {
  try {
    await updateGoalProgress(goalId, currentAmountYen);
  } catch (error) {
    return {
      error: error instanceof GoalStoreError ? error.message : '進捗を更新できませんでした。',
    };
  }
  revalidatePath('/advisor');
  return { error: null };
}

export async function abandonGoalAction(goalId: string): Promise<{ error: string | null }> {
  try {
    await abandonGoal(goalId);
  } catch (error) {
    return {
      error: error instanceof GoalStoreError ? error.message : '目標を更新できませんでした。',
    };
  }
  revalidatePath('/advisor');
  return { error: null };
}
