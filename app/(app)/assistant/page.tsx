import { AssistantChat } from './assistant-chat';

/**
 * AIの窓口(ADR-054 → 059 → 103 → 108)。下のタブの「AI」で開く、ふつうの画面。
 * 会話はアプリを開いているあいだ残る(ほかの画面へ移って戻っても続きから)。
 */
export default async function AssistantChatPage({
  searchParams,
}: {
  searchParams: Promise<{ context?: string | string[] }>;
}) {
  const { context } = await searchParams;
  return (
    <AssistantChat
      variant="page"
      initialPrompt={
        context === 'savings'
          ? '貯金目標について相談したいです。今の貯まり具合と毎月の目標から、無理のない金額と期限を一緒に考えてください。'
          : undefined
      }
    />
  );
}
