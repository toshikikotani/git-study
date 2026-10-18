'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/** 画面の移動を待つ表示を、これより長く待ったときだけ出す(すぐ切り替わるときは出さない)。 */
const SHOW_AFTER_MS = 150;
/** 返事が来ないまま、これより長くたったら消す。 */
const GIVE_UP_MS = 15_000;

/** リンクの押下から、移動先(パスと検索)を取り出す。同じ画面・外の画面・新しいタブなら null。 */
export function navigationTarget(
  anchor: { href: string; target?: string; hasAttribute: (name: string) => boolean },
  current: { origin: string; pathname: string; search: string },
): string | null {
  if (anchor.target && anchor.target !== '_self') return null;
  if (anchor.hasAttribute('download')) return null;
  let url: URL;
  try {
    url = new URL(anchor.href, current.origin);
  } catch {
    return null;
  }
  if (url.origin !== current.origin) return null;
  const to = url.pathname + url.search;
  return to === current.pathname + current.search ? null : to;
}

/**
 * 画面を移るのを待っているあいだ、画面のいちばん上に細い帯を流す(ADR-117)。
 * 保存のあとは、端末に残した画面が作り直しになり(サーバーアクションの revalidatePath がすべて消す)、
 * 次の画面はサーバーの返事を待つ。そのあいだ何も変わらず、固まったように見えていた(本人の指摘)。
 * 枠だけ先に出す表示はやめた(2026-10-02)ので、今の画面はそのまま、待っていることだけを示す。
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const [pending, setPending] = useState<{ to: string; from: string } | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // Next の Link は押下を自分で受け取り(既定の動きを止め)、画面の中で移る。
      if (!e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const anchor = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const to = navigationTarget(anchor, window.location);
      if (to !== null) setPending({ to, from: window.location.pathname + window.location.search });
    };
    const onPop = () => setPending(null);
    document.addEventListener('click', onClick);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  // 移った(パスが変わった)ら消す。検索だけ変わる移動と、返事が来ないときのために時間でも消す。
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setPending(null);
  }
  useEffect(() => {
    if (pending === null) return;
    const check = window.setInterval(() => {
      if (window.location.pathname + window.location.search !== pending.from) setPending(null);
    }, 100);
    const giveUp = window.setTimeout(() => setPending(null), GIVE_UP_MS);
    return () => {
      window.clearInterval(check);
      window.clearTimeout(giveUp);
    };
  }, [pending]);

  if (pending === null) return null;
  return (
    <div
      role="progressbar"
      aria-label="画面を読み込んでいます"
      className="nav-progress"
      style={{ animationDelay: `${SHOW_AFTER_MS}ms` }}
    />
  );
}
