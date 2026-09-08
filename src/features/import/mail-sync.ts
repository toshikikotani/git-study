/**
 * 通知メールの取り込み(FR-10 の自動経路)。
 *
 * MailSource から受け取ったメールを、明細に変換して返すところまでを担う。
 * ネットワークにも DB にも触れないため、偽の MailSource を渡せば
 * 資格情報なしで挙動を検証できる。
 *
 * 流れ:
 *   取得 → 解析(ラベル辞書 → 駄目なら AI) → 検知ルール適用 → 重複排除 → 結果
 *
 * 解析を2段にしている理由:
 *   ラベル辞書 発行元が様式を変えると取りこぼす。ただし費用ゼロで確実
 *   AI        辞書の知らない書式を拾う。費用がかかるので読めなかった分だけ
 * どちらの経路を通っても、リボ・キャッシングの判定は同じ正規表現が行う
 * (ADR-010。検知をモデルの出力に依存させない)。
 *
 * 重複排除を2段構えにしている理由:
 *   messageId  同じメールを二度読まない(再実行しても増えない)
 *   fingerprint 同じ明細が CSV とメールの両方から入るのを防ぐ
 * 通知メールと月次 CSV には必ず重なりが出る。片方だけでは支出が倍になる。
 */

import { applyRules, type ClassificationRule } from '@/features/classification/rules';
import { fingerprintOf, type StoredTransaction } from '@/features/transactions/store';
import type { AiEmailExtractor } from './email-ai';
import { parseNotificationEmail, type EmailParseResult } from './email';
import type { MailQuery, MailSource, RawMessage } from './mailbox';

export type SyncInput = {
  source: MailSource;
  query: MailQuery;
  rules: readonly ClassificationRule[];
  /** 既に取り込み済みのメール ID。再実行で二重に読まないため。 */
  knownMessageIds: ReadonlySet<string>;
  /** 既に取り込み済みの明細キー。CSV との重複を防ぐため。 */
  knownFingerprints: ReadonlySet<string>;
  batchId: string;
  /**
   * ラベル辞書で読めなかったメールの救済(ADR-019)。
   * 省略すれば AI は一切呼ばれない(費用が発生しない)。
   */
  ai?:
    | {
        extractor: AiEmailExtractor;
        /**
         * 1回の取り込みで AI に投げる上限。
         * 受信箱に想定外のメールが大量にあっても、費用が青天井にならないようにする。
         */
        maxCalls: number;
      }
    | undefined;
};

export type SyncResult = {
  transactions: StoredTransaction[];
  /** 今回読んだメールの ID。次回の knownMessageIds に足す。 */
  processedMessageIds: string[];
  /** 解析できなかったメールと理由。黙って捨てない(NFR-06)。 */
  warnings: { messageId: string; subject: string; message: string }[];
  scannedMessageCount: number;
  duplicateCount: number;
  /** AI を呼んだ回数。費用が見えるように結果へ残す。 */
  aiCallCount: number;
};

export async function syncFromMailbox(input: SyncInput): Promise<SyncResult> {
  const messages = await input.source.fetch(input.query);

  const transactions: StoredTransaction[] = [];
  const processedMessageIds: string[] = [];
  const warnings: SyncResult['warnings'] = [];
  const seen = new Set(input.knownFingerprints);
  let duplicateCount = 0;
  let aiCallCount = 0;

  for (const message of messages) {
    if (input.knownMessageIds.has(message.messageId)) continue;
    processedMessageIds.push(message.messageId);

    let parsed: EmailParseResult = parseNotificationEmail(message.body);

    // 辞書で1件も読めなかったときだけ AI に回す。
    // 読めている大多数のメールでは API を叩かないので、通常運転の費用はゼロ。
    if (parsed.transactions.length === 0 && input.ai && aiCallCount < input.ai.maxCalls) {
      aiCallCount += 1;
      const rescued = await input.ai.extractor.extract({
        body: message.body,
        subject: message.subject,
      });
      // 救済できたときだけ差し替える。駄目だったなら辞書側の理由も残したい。
      parsed =
        rescued.transactions.length > 0
          ? rescued
          : { transactions: [], warnings: [...parsed.warnings, ...rescued.warnings] };
    }

    for (const warning of parsed.warnings) {
      warnings.push({
        messageId: message.messageId,
        subject: message.subject,
        message: warning,
      });
    }

    parsed.transactions.forEach((tx, index) => {
      const fingerprint = fingerprintOf(tx);
      if (seen.has(fingerprint)) {
        duplicateCount += 1;
        return;
      }
      seen.add(fingerprint);

      const classification = applyRules(
        {
          accountId: 'gmail',
          description: tx.description,
          amountYen: tx.amountYen,
          paymentMethod: tx.paymentMethod,
        },
        input.rules,
      );

      transactions.push({
        id: `${message.messageId}-${index}`,
        occurredOn: tx.occurredOn,
        description: tx.description,
        amountYen: tx.amountYen,
        paymentMethod: classification.paymentMethod,
        categoryId: classification.categoryId,
        categoryName: null,
        classifiedBy: classification.categoryId ? 'rule' : 'unclassified',
        reviewStatus: classification.categoryId ? 'auto_ok' : 'pending',
        fingerprint,
        batchId: input.batchId,
      });
    });
  }

  return {
    transactions,
    processedMessageIds,
    warnings,
    scannedMessageCount: messages.length,
    duplicateCount,
    aiCallCount,
  };
}

/** テストと画面プレビュー用。決まった本文を返すだけの MailSource。 */
export class StaticMailSource implements MailSource {
  constructor(private readonly messages: readonly RawMessage[]) {}

  async fetch(query: MailQuery): Promise<RawMessage[]> {
    return this.messages.filter((m) => {
      if (m.receivedOn < query.since) return false;
      const senders = query.fromAddresses ?? [];
      if (senders.length === 0) return true;
      return senders.some((s) => m.from.includes(s));
    });
  }
}
