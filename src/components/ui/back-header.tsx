import type { Route } from 'next';
import Link from 'next/link';

/**
 * 「‹ 戻り先」(提案書「戻るボタンは ‹ 前の画面の名前 と キャンセル だけ」、ADR-127)。入力をやめる画面は
 * `cancel` で「キャンセル」(矢印なし)にする。
 */
export function BackLink({ back }: { back: { href: string; label: string; cancel?: boolean } }) {
  return (
    <Link
      href={back.href as Route}
      className="flex min-h-11 items-center gap-1 self-start text-[17px] font-semibold"
      style={{ color: 'var(--accent)' }}
    >
      {back.cancel ? null : (
        <svg
          aria-hidden
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 5l-7 7 7 7" />
        </svg>
      )}
      {back.cancel ? 'キャンセル' : back.label}
    </Link>
  );
}

/**
 * 下の階層の画面の見出し(デザイン仕様書の「見通し」と同じ形、ADR-090):左上に「‹ 戻り先」、
 * その下に大きな見出しと補足。右上に置く操作は action で渡す。
 */
export function BackHeader({
  back,
  title,
  sub,
  action,
}: {
  back: { href: string; label: string; cancel?: boolean };
  title: string;
  sub?: string;
  action?: React.ReactNode;
}) {
  return (
    <>
      <div className="flex min-h-11 items-center justify-between">
        <BackLink back={back} />
        {action ?? null}
      </div>
      <header className="-mt-2 px-1">
        <h1 className="text-[34px] leading-tight font-bold" style={{ color: 'var(--ink)' }}>
          {title}
        </h1>
        {sub ? (
          <p className="text-[15px]" style={{ color: 'var(--ink-muted)' }}>
            {sub}
          </p>
        ) : null}
      </header>
    </>
  );
}
