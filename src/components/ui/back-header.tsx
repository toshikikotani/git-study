import type { Route } from 'next';
import Link from 'next/link';

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
  back: { href: string; label: string };
  title: string;
  sub?: string;
  action?: React.ReactNode;
}) {
  return (
    <>
      <div className="flex min-h-11 items-center justify-between">
        <Link
          href={back.href as Route}
          className="flex min-h-11 items-center gap-1 text-[17px] font-medium"
          style={{ color: 'var(--accent)' }}
        >
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
          {back.label}
        </Link>
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
