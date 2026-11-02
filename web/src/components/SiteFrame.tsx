"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const NAV: { href: string; label: string; active: (p: string) => boolean; className?: string }[] = [
  { href: "/", label: "Studio", active: (p) => p === "/" },
  { href: "/#pipeline", label: "Process", active: () => false, className: "hidden lg:inline-flex" },
  { href: "/library", label: "Library", active: (p) => p.startsWith("/library") || p.startsWith("/jobs") },
  { href: "/calendar", label: "Calendar", active: (p) => p.startsWith("/calendar") },
];

export function SiteFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";

  return (
    <div className="min-h-full">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-volt focus:px-4 focus:py-2 focus:font-bold focus:text-[#101016]"
      >
        Skip to content
      </a>

      <header className="site-frame-header">
        <div className="mx-auto flex h-[72px] w-full max-w-[1320px] items-center gap-3">
          <Link href="/" aria-label="Chop Shop home" className="site-frame-brand flex shrink-0 items-center">
            <span aria-hidden="true" className="site-frame-brand-mark grid place-items-center">CS/</span>
            <span>CHOP SHOP</span>
          </Link>

          <nav aria-label="Main navigation" className="site-frame-nav flex min-w-0 flex-1 items-center">
            {NAV.map((item) => {
              const current = item.active(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={item.className ?? ""}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="site-frame-right flex shrink-0 items-center">
            <span className="site-frame-live">
              <span aria-hidden="true" className="site-frame-live-dot" />
              Local-first cut room
            </span>
            <Link href="/#studio" aria-label="New cut" className="site-frame-new">
              + New cut
            </Link>
          </div>
        </div>
      </header>

      <div id="content" tabIndex={-1} className="outline-none">
        {children}
      </div>
    </div>
  );
}
