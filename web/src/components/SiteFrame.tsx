import Link from "next/link";
import type { ReactNode } from "react";

export function SiteFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b-4 border-court bg-volt px-4 py-3 text-ink md:px-6">
        <Link href="/" className="display text-3xl leading-none md:text-4xl">
          Clipper
        </Link>
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 bg-punch" aria-hidden />
          <span className="text-sm font-semibold">On air</span>
        </div>
        <nav className="justify-self-end text-sm font-semibold">
          <Link href="/library" className="underline decoration-2 underline-offset-4">
            Library
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
