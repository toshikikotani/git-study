/**
 * LINE で受け取ったレシートの写真(受信 Webhook、本人発案)。読み取って「保存前」に残し、読み取った内容と
 * 「確かめて保存」のボタンを返す。明細にはしない:記録するのは、本人がアプリで確かめて「保存」を押したとき
 * だけ(本人「自動登録機能は完全廃止、必ずユーザーが確認する」、ADR-141)。
 *
 * もとは読み取ってそのまま記録し、夜の答え合わせで確かめていた(ADR-133 で LINE だけ残していた)。
 * 読み取り・残し方は iPhone アプリと同じ(features/receipt-captures/keep-photo.ts)。
 */

import { lineText, type LineMessage } from '@/lib/line';
import { checkPathOf, type KeepPhotoResult } from '@/features/receipt-captures/keep-photo';

/** 返信に出す注意の数(多いと読み取った内容が埋もれる)。 */
const MAX_WARNINGS = 2;

/** 2026-10-27 → 10/27 */
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/**
 * LINE への返事。読み取った内容(日付・お店・金額・カテゴリ)と、確かめる画面を開くボタン。
 * 「保存しました」とは言わない(保存していないので)。
 */
export function lineReceiptReply(result: KeepPhotoResult, appBaseUrl: string | null): LineMessage {
  if (result.error !== null) {
    return lineText(`レシートを残せませんでした: ${result.error}`);
  }
  const lines =
    result.needsInputId !== null
      ? [
          'レシートの読めなかった所があります。まだ保存していません。',
          '写真を見ながら入れてください。',
        ]
      : [
          'レシートを読み取りました。まだ保存していません。',
          ...result.ready.map(
            (r) =>
              `${md(r.occurredOn)} ${r.storeName} ${r.amountYen.toLocaleString('ja-JP')}円(${r.genreName ?? 'カテゴリ未定'})`,
          ),
          '確かめて「保存」を押すと記録します。',
        ];
  lines.push(...result.warnings.slice(0, MAX_WARNINGS).map((w) => `⚠ ${w}`));
  if (appBaseUrl === null) {
    lines.push('アプリの「確認が必要」から確かめられます。');
    return lineText(lines.join('\n'));
  }
  return lineText(lines.join('\n'), [
    {
      kind: 'uri',
      label: result.needsInputId !== null ? '入力する' : '確かめて保存',
      uri: `${appBaseUrl}${checkPathOf(result)}`,
    },
  ]);
}
