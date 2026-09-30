/**
 * デザインQA用:サーバーの「今日」を固定する(FAKE_NOW=2026-09-15T03:00:00Z のように渡す)。
 * `node --require ./fake-date.cjs` で読み込む。時刻は固定したまま進まない。
 */
const fixed = process.env.FAKE_NOW ? new Date(process.env.FAKE_NOW).getTime() : null;
if (fixed !== null) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() {
      return fixed;
    }
  }
  // Next.js は Date の自前のプロパティを写して差し替えるため、継承ではなく自前で持たせる。
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  global.Date = FakeDate;
}
