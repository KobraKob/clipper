"use client";

import Link from "next/link";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="flex min-h-[65vh] flex-col items-center justify-center px-4 py-16 text-center">
      <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-rose-300">Studio interruption</p>
      <h1 className="display mt-4 text-4xl text-white sm:text-6xl">That did not render.</h1>
      <p className="mt-4 max-w-lg text-sm leading-7 text-slate-300">
        Something went wrong while loading this page. Your saved projects have not been intentionally changed.
        Retry the page or return to the Studio.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={() => reset()} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-indigo-500 px-5 text-sm font-bold text-white transition hover:bg-indigo-400 active:scale-[0.98]">
          Try again
        </button>
        <Link href="/" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/20 px-5 text-sm font-semibold text-slate-100 transition hover:bg-white/10 active:scale-[0.98]">
          Go to Studio
        </Link>
      </div>
    </section>
  );
}
