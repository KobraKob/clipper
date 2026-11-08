import Link from "next/link";

export default function NotFound() {
  return (
    <section className="flex min-h-[65vh] flex-col items-center justify-center px-4 py-16 text-center">
      <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">Error 404</p>
      <h1 className="display mt-4 text-5xl text-white sm:text-7xl">Wrong cut.</h1>
      <p className="mt-4 max-w-lg text-sm leading-7 text-slate-300">
        This page does not exist or may have moved. Your projects are still in the Library.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-indigo-500 px-5 text-sm font-bold text-white transition hover:bg-indigo-400 active:scale-[0.98]">
          Back to Studio
        </Link>
        <Link href="/library" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/20 px-5 text-sm font-semibold text-slate-100 transition hover:bg-white/10 active:scale-[0.98]">
          Open Library
        </Link>
      </div>
    </section>
  );
}
