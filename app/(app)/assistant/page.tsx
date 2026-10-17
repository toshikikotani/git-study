import { AssistantChat } from './assistant-chat';

/**
 * AIの窓口(ADR-054 → 059 → 103 → 108)。下のタブの「AI」で開く、ふつうの画面。
 * 会話はアプリを開いているあいだ残る(ほかの画面へ移って戻っても続きから)。
 */
export default function AssistantChatPage() {
  return <AssistantChat variant="page" />;
}
