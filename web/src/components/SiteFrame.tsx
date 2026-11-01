import Link from "next/link";
import type { ReactNode } from "react";

export function SiteFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full">
      <header className="site-frame-header">
        <Link href="/" className="site-frame-brand" aria-label="Chop Shop home">
          <span className="site-frame-brand-mark" aria-hidden="true">CS/</span>
          <span>CHOP SHOP</span>
        </Link>

        <nav className="site-frame-nav" aria-label="Main navigation">
          <Link href="/#studio">Create</Link>
          <Link href="/#pipeline" className="hidden lg:inline-flex">Process</Link>
          <Link href="/library">Library</Link>
          <Link href="/calendar">Calendar</Link>
        </nav>

        <div className="site-frame-right">
          <span className="site-frame-live">
            <span className="site-frame-live-dot" aria-hidden="true" />
            LOCAL-FIRST CUT ROOM
          </span>
          <Link className="site-frame-new" href="/#studio">
            New cut <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
