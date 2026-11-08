import Link from "next/link";
import type { ReactNode } from "react";

type LegalPageProps = {
  title: string;
  intro: string;
  notice: string;
  children: ReactNode;
};

export function LegalPage({ title, intro, notice, children }: LegalPageProps) {
  return (
    <div className="min-h-[65vh] px-4 py-10 sm:px-6 lg:px-8 lg:py-16">
      <div className="mx-auto max-w-3xl">
        <header className="border-b border-white/10 pb-7">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">
            Chop Shop / Product information
          </p>
          <h1 className="display mt-4 text-4xl text-white sm:text-5xl">{title}</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">{intro}</p>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-slate-500">
            Updated November 8, 2026
          </p>
        </header>
        <aside role="note" className="mt-7 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-200">Owner review required</p>
          <p className="mt-1 text-sm leading-6 text-slate-300">{notice}</p>
        </aside>
        <article className="mt-8 space-y-7 text-sm leading-7 text-slate-300 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-white [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-2">
          {children}
        </article>
        <div className="mt-10 border-t border-white/10 pt-5">
          <Link href="/" className="inline-flex min-h-11 items-center text-sm font-semibold text-cyan-300 underline underline-offset-4 hover:text-white">
            Back to Chop Shop Studio
          </Link>
        </div>
      </div>
    </div>
  );
}
