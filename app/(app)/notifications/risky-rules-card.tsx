/**
 * FR-21(リボ払い・キャッシング・分割払いの検知)の一覧表示(ADR-057)。
 *
 * 旧 /rules は本人が分類ルールを編集する画面だったが、ADR-057により
 * パターンによる分類(classification_rules)自体を廃止したため、その画面も
 * 廃止した。ただし FR-21 の検知ルールだけは、廃止対象ではなく見逃しが
 * 致命的な固定の安全装置(ADR-010、DB を介さず features/classification/rules.ts
 * に直接持つ)——本人が「今どのパターンを検知しているか」を確認できる
 * 場所を無くさないよう、読み取り専用のまま小さく残す(いまはお知らせの画面、ADR-127)。
 * 編集はできない(会話からも app/api/assistant/chat/route.ts で二重に拒む)。
 */

/**
 * 見つけるもの(リボ払い・キャッシング・分割払い)を一文で言う。中で使う文字の式
 * (「リボ|ﾘﾎﾞ|revolving|リボルビング」など)は出さない(読む人には意味がない、ADR-131)。
 */
export function RiskyRulesCard() {
  return (
    <div
      className="hm-panel hm-section"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h2 className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
        危ない支払い方の見張り
      </h2>
      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        {/* 言葉の途中で折れないように(「キャッシ／ング」と折れていた)。 */}
        <span className="whitespace-nowrap">リボ払い</span>・
        <span className="whitespace-nowrap">キャッシング</span>・
        <span className="whitespace-nowrap">分割払い</span>を見つけたら知らせます。
      </p>
      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        見逃すと困るので、いつも決まった方法で探します(ここや会話からは変えられません)。
      </p>
    </div>
  );
}
