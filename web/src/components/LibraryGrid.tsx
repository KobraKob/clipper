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
      <p role="alert" className="border-4 border-punch bg-punch px-4 py-3 font-semibold text-white">
        {error}
      </p>
    );
  }

  if (!jobs) {
    return <p className="font-semibold text-lg">Loading cuts from library…</p>;
  }

  if (jobs.length === 0) {
    return (
      <div className="border-4 border-court bg-white p-6 stamp">
        <p className="display text-5xl text-court">No cuts yet</p>
        <p className="mt-3 max-w-md">Drop a long video or URL and this shelf fills with ranked 9:16 vertical clips.</p>
        <Link href="/" className="mt-6 inline-block border-4 border-court bg-punch px-4 py-3 font-semibold text-white stamp-sm hover:bg-punch/90 transition">
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
              className="block border-4 border-court bg-white stamp-sm hover:bg-volt/40 transition group"
            >
              <div className="flex items-center justify-between border-b-4 border-court bg-court px-3 py-2 text-volt">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-3 w-3 rounded-full ${isDone ? "bg-volt" : "bg-punch animate-pulse"}`}
                  />
                  <span className="display text-2xl">
                    {isDone ? "Ready" : `Processing (${Math.round(job.progress * 100)}%)`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase font-mono bg-volt text-ink px-2 py-0.5 font-bold">
                    {job.provider}
                  </span>
                  <button
                    type="button"
                    title="Delete cut"
                    onClick={(e) => handleDelete(e, job.id)}
                    className="border border-volt bg-court px-2 py-0.5 text-xs font-mono font-bold text-volt hover:bg-punch hover:text-white transition"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="p-4">
                <p className="break-all font-semibold text-court">{job.source}</p>
                <p className="mt-2 text-sm text-ink/70">
                  {job.clipCount} clips · {job.vertical ? "9:16 vertical" : "source frame"} ·{" "}
                  {job.captions ? "animated captions" : "captions off"}
                </p>
                {job.clips[0] ? (
                  <div className="mt-3 border-t-2 border-court/20 pt-2">
                    <p className="display text-2xl text-court group-hover:text-ink">{job.clips[0].title}</p>
                    <p className="text-xs font-semibold text-ink/70">
                      Top clip starts at {formatTimecode(job.clips[0].start)} · Score {job.clips[0].score}/100
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm italic text-ink/60">Processing candidate speech segments…</p>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
