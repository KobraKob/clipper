import type { Metadata } from "next";
import Link from "next/link";
import { LibraryGrid } from "@/components/LibraryGrid";

export const metadata: Metadata = {
  title: "Library — Chop Shop",
  description: "Browse, filter, and manage all your processed video cutting projects and extracted clips.",
};

export default function LibraryPage() {
  return (
    <div className="min-h-screen py-8 lg:py-12">
      <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8 flex flex-col gap-8">
        <header className="flex flex-col gap-4 border-b border-white/[0.08] pb-8">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 font-mono text-xs text-slate-400">
            <Link href="/" className="transition hover:text-white">
              Studio
            </Link>
            <span aria-hidden="true" className="text-slate-600">/</span>
            <span aria-current="page" className="text-indigo-400 font-semibold">
              Library
            </span>
          </nav>

          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-cyan-300 mb-2">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                All Saved Projects
              </span>
              <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold uppercase tracking-tight text-white leading-none">
                Media Library
              </h1>
              <p className="mt-2 text-sm sm:text-base text-slate-300">
                Search processed long-form videos, check pipeline execution metrics, inspect generated shorts, and download or schedule rendered clips.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/calendar"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-200 hover:bg-white/[0.08] hover:text-white transition-all shadow-sm"
              >
                <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>Publishing Calendar</span>
              </Link>
              <Link
                href="/#studio"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 px-5 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 hover:brightness-110 transition-all"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                <span>Create New Cut</span>
              </Link>
            </div>
          </div>
        </header>

        <section id="library-results" aria-label="Saved projects">
          <LibraryGrid />
        </section>
      </div>
    </div>
  );
}
