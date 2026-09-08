'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/', label: 'ホーム' },
  { href: '/debts', label: '負債' },
  { href: '/transactions', label: '明細' },
  { href: '/payday', label: '給料日' },
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <main className="flex-1 px-4 pt-6 pb-28">{children}</main>

      {/* 片手で届く位置に浮かせる。主な閲覧はスマートフォン(NFR-07) */}
      <nav className="fixed inset-x-0 bottom-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <ul
          className="mx-auto flex w-full max-w-md rounded-full p-1 ring-1 backdrop-blur-xl"
          style={{
            background: 'color-mix(in srgb, var(--surface-raised) 82%, transparent)',
            boxShadow: '0 4px 24px -8px rgba(0,0,0,0.25)',
          }}
        >
          {NAV.map((item) => {
            const isActive = pathname === item.href;
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className="block rounded-full py-2.5 text-center text-[13px] font-medium transition-colors"
                  style={
                    isActive
                      ? { background: 'var(--accent)', color: '#ffffff' }
                      : { color: 'var(--ink-secondary)' }
                  }
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
