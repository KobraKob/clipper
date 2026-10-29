import Link from "next/link";
import { LibraryGrid } from "@/components/LibraryGrid";

export default function LibraryPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-7 px-4 py-7 md:px-8 md:py-10">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs font-semibold text-muted">
        <Link href="/" className="transition hover:text-volt">Studio</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="text-ink">Library</span>
      </nav>

      <header className="flex flex-col justify-between gap-5 border-b border-white/10 pb-7 md:flex-row md:items-end">
        <div className="max-w-2xl">
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-ice">CLIPPER WORKSPACE / 01</p>
          <h1 className="display mt-3 text-5xl text-ink md:text-7xl">Your library<span className="text-volt">.</span></h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted md:text-base">
            Find past projects, track processing, and reopen your edits. Filter the list when your workspace grows.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/#pipeline" className="inline-flex min-h-10 items-center rounded-lg border border-white/12 bg-panel px-4 py-2 text-xs font-bold text-ink transition hover:border-ice/50">
            How it works
          </Link>
          <Link href="/#studio" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-volt px-4 py-2 text-xs font-extrabold text-[#080b10] transition hover:bg-[#ddff83]">
            Create a cut <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>

      <LibraryGrid />
    </main>
  );
}
