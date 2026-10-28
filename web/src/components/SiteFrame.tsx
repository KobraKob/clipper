import Link from "next/link";
import type { ReactNode } from "react";

export function SiteFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full">
      <header className="site-frame-header">
        <Link href="/" className="site-frame-brand" aria-label="Clipper home">
          <span className="site-frame-brand-mark" aria-hidden="true">C/</span>
          <span>CLIPPER</span>
        </Link>
        <div className="site-frame-live hidden sm:inline-flex">
          <span className="site-frame-live-dot" aria-hidden="true" />
          <span>Local-first studio</span>
        </div>
        <nav className="site-frame-nav" aria-label="Main navigation">
          <Link href="/#studio" className="nav-create-link">Create</Link>
          <Link href="/#pipeline" className="hidden lg:inline-block">Workflow</Link>
          <Link href="/library" className="nav-library-link">Library <span aria-hidden="true">↗</span></Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
