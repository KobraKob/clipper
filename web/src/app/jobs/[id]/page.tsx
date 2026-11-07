import Link from "next/link";
import { JobStudio } from "@/components/JobStudio";

export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="min-h-screen py-8 lg:py-10">
      <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8 flex flex-col gap-6">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 font-mono text-xs text-slate-400">
            <Link href="/" className="hover:text-white transition-colors">Studio</Link>
            <span aria-hidden="true" className="text-slate-600">/</span>
            <Link href="/library" className="hover:text-white transition-colors">Library</Link>
            <span aria-hidden="true" className="text-slate-600">/</span>
            <span aria-current="page" className="text-indigo-400 font-semibold">Job Workspace</span>
          </nav>
          <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 rounded-md">
            Cut Inspector
          </span>
        </div>
        <JobStudio jobId={id} />
      </div>
    </div>
  );
}
