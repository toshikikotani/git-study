import { AssistantChat } from './assistant-chat';

/**
 * AIの窓口(ADR-054 → 059 → 103)。ふだんは下のAIボタンから、どの画面でもシートで開く。
 * この画面(/assistant)も同じ部品で、同じ会話の続きになる。
 */
export default function AssistantChatPage() {
  return <AssistantChat variant="page" />;
}
