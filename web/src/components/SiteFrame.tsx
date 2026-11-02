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

      <header className="sticky top-0 z-40 border-b border-white/10 bg-panel">
        <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-3 px-4 md:gap-6 md:px-6">
          <Link href="/" aria-label="Chop Shop home" className="flex shrink-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid h-8 place-items-center rounded-md bg-volt px-1.5 font-mono text-xs font-black text-[#101016]"
            >
              CS/
            </span>
            <span className="display hidden text-xl text-ink sm:block">CHOP SHOP</span>
          </Link>

          <nav aria-label="Main navigation" className="flex min-w-0 flex-1 items-center gap-1">
            {NAV.map((item) => {
              const current = item.active(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={`inline-flex h-9 items-center rounded-lg px-2.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-ice md:px-3.5 ${
                    current ? "bg-panel-raised text-ink" : "text-muted hover:bg-panel-raised/60 hover:text-ink"
                  } ${item.className ?? ""}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-4">
            <span className="hidden font-mono text-[10px] font-bold uppercase tracking-[.16em] text-muted xl:block">
              Local-first cut room
            </span>
            <Link
              href="/#studio"
              aria-label="New cut"
              className="stamp-sm inline-flex h-9 items-center rounded-lg bg-volt px-3.5 text-sm font-bold text-[#101016] transition hover:bg-[#e4ff78]"
            >
              <span aria-hidden="true" className="sm:hidden">+</span>
              <span className="hidden sm:inline">+ New cut</span>
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