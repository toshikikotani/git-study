'use client';

import { signOutAction } from '@/features/auth/actions';

function clearSession() {
  try {
    window.sessionStorage.clear();
  } catch {
    // 消せなくてもログアウトは続ける
  }
}

/** 設定の画面の一番下のログアウト(押せる大きさ 44pt)。 */
export function SignOutButton() {
  return (
    <form action={signOutAction} onSubmit={clearSession}>
      <button
        type="submit"
        className="min-h-11 w-full rounded-2xl px-4 py-3 text-left text-[15px] font-semibold"
        style={{ background: 'var(--surface)', color: 'var(--over)' }}
      >
        ログアウト
      </button>
    </form>
  );
}
