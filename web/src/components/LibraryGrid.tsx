"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { deleteJob, fetchJobs } from "@/lib/api";
import { formatTimecode } from "@/lib/pipeline";
import type { JobView } from "@/lib/types";

export function LibraryGrid() {
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchJobs()
      .then(setJobs)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load the library.");
      });
  }, []);

  async function handleDelete(e: React.MouseEvent, jobId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this cut and all its exported clips?")) {
      return;
    }
    try {
      await deleteJob(jobId);
      setJobs((prev) => (prev ? prev.filter((j) => j.id !== jobId) : []));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete cut.");
    }
  }

  if (error) {
    return (
      <p role="alert" className="border border-punch/60 bg-punch/15 px-4 py-3 font-semibold text-punch rounded-lg">
        {error}
      </p>
    );
  }

  if (!jobs) {
    return <p className="font-semibold text-lg text-muted py-8 text-center">Loading cuts from library…</p>;
  }

  if (jobs.length === 0) {
    return (
      <div className="border border-white/15 bg-panel p-8 md:p-12 rounded-xl stamp-sm text-center max-w-lg mx-auto">
        <p className="display text-4xl md:text-5xl text-volt">No cuts yet</p>
        <p className="mt-3 text-muted text-sm md:text-base leading-relaxed">
          Drop a long video or URL and this shelf fills with ranked 9:16 vertical clips.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block bg-volt text-[#101016] px-5 py-3 font-bold rounded-lg stamp-sm hover:bg-[#e4ff78] transition"
        >
          Cut clips now
        </Link>
      </div>
    );
  }

  return (
    <ul className="grid gap-5 md:grid-cols-2">
      {jobs.map((job) => {
        const isDone = job.status === "done";
        return (
          <li key={job.id}>
            <Link
              href={`/jobs/${job.id}`}
              className="block border border-white/15 bg-panel hover:border-volt/60 rounded-xl overflow-hidden stamp-sm transition group"
            >
              <div className="flex items-center justify-between border-b border-white/12 bg-panel-raised px-4 py-2.5 text-volt">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${isDone ? "bg-volt" : "bg-punch animate-pulse"}`}
                  />
                  <span className="display text-xl md:text-2xl">
                    {isDone ? "Ready" : `Processing (${Math.round(job.progress * 100)}%)`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase font-mono bg-volt text-[#101016] px-2 py-0.5 font-bold rounded">
                    {job.provider}
                  </span>
                  <button
                    type="button"
                    title="Delete cut"
                    onClick={(e) => handleDelete(e, job.id)}
                    className="border border-punch/40 bg-punch/10 px-2 py-0.5 text-xs font-mono font-bold text-punch hover:bg-punch hover:text-white rounded transition cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="p-4 md:p-5">
                <p className="break-all font-mono text-sm text-ink font-semibold">{job.source}</p>
                <p className="mt-2 text-xs text-muted">
                  {job.clipCount} clips · {job.vertical ? "9:16 vertical" : "source frame"} ·{" "}
                  {job.captions ? "animated captions" : "captions off"}
                </p>
                {job.clips[0] ? (
                  <div className="mt-3 border-t border-white/10 pt-3">
                    <p className="display text-xl md:text-2xl text-ink group-hover:text-volt transition">
                      {job.clips[0].title}
                    </p>
                    <p className="text-xs font-semibold text-muted mt-0.5">
                      Top clip starts at {formatTimecode(job.clips[0].start)} · Score {job.clips[0].score}/100
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-xs italic text-muted">Processing candidate speech segments…</p>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
