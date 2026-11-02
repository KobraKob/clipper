import type { Metadata } from "next";
import Link from "next/link";
import { LibraryGrid } from "@/components/LibraryGrid";
//import { LibraryShortcuts } from "@/components/LibraryShortcuts";

export const metadata: Metadata = { title: "Library" };

export default function LibraryPage() {
  return (
    <main className="app-page library-page flex flex-col gap-8">
      {/* <LibraryShortcuts /> */}

      <header className="flex flex-col gap-5">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 font-mono text-xs text-muted">
          <Link href="/" className="transition hover:text-ink">
            Studio
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page" className="text-ink">
            Library
          </span>
        </nav>

        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0 max-w-2xl">
            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-ice">Your projects</p>
            <h1 className="display mt-1 text-5xl text-ink md:text-7xl">
              The library<span className="text-volt">.</span>
            </h1>
            <p className="mt-3 text-sm text-muted md:text-base">
              Search your projects, check processing status, and reopen a cut. Finished clips stay attached to the job
              they came from.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/calendar"
              className="stamp-sm inline-flex items-center gap-2 rounded-lg border border-white/20 bg-panel px-4 py-2 font-semibold text-ink transition hover:bg-panel-raised"
            >
              Publishing calendar
              <kbd className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-muted">P</kbd>
            </Link>
            <Link
              href="/#studio"
              className="stamp-sm inline-flex items-center gap-2 rounded-lg border border-volt bg-volt px-4 py-2 font-bold text-[#101016] transition hover:bg-[#e4ff78]"
            >
              + Create a cut
              <kbd className="rounded border border-[#101016]/30 px-1.5 py-0.5 font-mono text-[10px]">N</kbd>
            </Link>
          </div>
        </div>
      </header>

      <section id="library-results" aria-label="Saved projects" className="scroll-mt-6">
        <LibraryGrid />
      </section>
    </main>
  );
}