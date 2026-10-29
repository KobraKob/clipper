"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteJob, fetchJobs } from "@/lib/api";
import { formatTimecode } from "@/lib/pipeline";
import type { JobStatus, JobView } from "@/lib/types";
import { BulkCutUploader } from "@/components/BulkCutUploader";

type LibraryFilter = "all" | "ready" | "processing" | "failed";
type SortMode = "newest" | "oldest" | "most-clips";
type ViewMode = "grid" | "list";

function statusLabel(status: JobStatus, progress: number) {
  if (status === "done") return "Ready";
  if (status === "error") return "Needs attention";
  if (status === "queued") return "Queued";
  return `Processing · ${Math.round(progress * 100)}%`;
}

function statusClasses(status: JobStatus) {
  if (status === "done") return "border-volt/30 bg-volt/10 text-volt";
  if (status === "error") return "border-punch/40 bg-punch/10 text-punch";
  return "border-ice/30 bg-ice/10 text-ice";
}

function formatCreatedAt(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export function LibraryGrid() {
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showBatchImport, setShowBatchImport] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<SortMode>("newest");
  const [view, setView] = useState<ViewMode>("grid");

  const refreshJobs = useCallback(async () => {
    setRefreshing(true);
    try {
      setJobs(await fetchJobs());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the library.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchJobs()
      .then((nextJobs) => {
        if (cancelled) return;
        setJobs(nextJobs);
        setError("");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load the library.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const allJobs = jobs || [];
    return {
      all: allJobs.length,
      ready: allJobs.filter((job) => job.status === "done").length,
      processing: allJobs.filter((job) => job.status === "running" || job.status === "queued").length,
      failed: allJobs.filter((job) => job.status === "error").length,
    };
  }, [jobs]);

  const visibleJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matchesFilter = (job: JobView) => {
      if (filter === "ready") return job.status === "done";
      if (filter === "processing") return job.status === "running" || job.status === "queued";
      if (filter === "failed") return job.status === "error";
      return true;
    };
    return [...(jobs || [])]
      .filter((job) => {
        if (!matchesFilter(job)) return false;
        if (!query) return true;
        const topTitle = job.clips?.[0]?.title || "";
        return [job.source, job.id, job.provider, topTitle, job.error || ""]
          .some((value) => String(value).toLowerCase().includes(query));
      })
      .sort((a, b) => {
        if (sort === "oldest") return a.createdAt - b.createdAt;
        if (sort === "most-clips") return (b.clips?.length || 0) - (a.clips?.length || 0) || b.createdAt - a.createdAt;
        return b.createdAt - a.createdAt;
      });
  }, [jobs, search, filter, sort]);

  async function handleDelete(event: React.MouseEvent<HTMLButtonElement>, jobId: string) {
    event.preventDefault();
    event.stopPropagation();
    if (!window.confirm("Delete this project and all its exported clips? This cannot be undone.")) return;
    setDeletingId(jobId);
    setError("");
    try {
      await deleteJob(jobId);
      setJobs((previous) => (previous ? previous.filter((job) => job.id !== jobId) : []));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project.");
    } finally {
      setDeletingId(null);
    }
  }

  const filters: { value: LibraryFilter; label: string; count: number }[] = [
    { value: "all", label: "All projects", count: counts.all },
    { value: "ready", label: "Ready", count: counts.ready },
    { value: "processing", label: "In progress", count: counts.processing },
    { value: "failed", label: "Needs attention", count: counts.failed },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="overflow-hidden rounded-xl border border-white/12 bg-panel" aria-label="Library overview">
        <div className="grid grid-cols-2 divide-x divide-y divide-white/10 md:grid-cols-4 md:divide-y-0">
          {[
            { label: "All projects", value: counts.all, accent: "text-ink" },
            { label: "Ready to review", value: counts.ready, accent: "text-volt" },
            { label: "Processing", value: counts.processing, accent: "text-ice" },
            { label: "Needs attention", value: counts.failed, accent: "text-punch" },
          ].map((item) => (
            <div key={item.label} className="px-4 py-4 md:px-5 md:py-5">
              <p className="text-[10px] font-bold uppercase tracking-[.13em] text-muted">{item.label}</p>
              <p className={`mt-2 font-mono text-3xl font-bold tabular-nums ${item.accent}`}>{jobs === null ? "—" : item.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-white/12 bg-panel">
        <button
          type="button"
          aria-expanded={showBatchImport}
          onClick={() => setShowBatchImport((current) => !current)}
          className="flex w-full flex-wrap items-center justify-between gap-3 bg-panel-raised px-4 py-4 text-left transition hover:bg-panel md:px-5"
        >
          <span className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg border border-volt/30 bg-volt/10 font-mono text-lg font-bold text-volt">+</span>
            <span>
              <strong className="block text-sm text-ink">Batch import</strong>
              <span className="mt-1 block text-xs text-muted">Upload multiple videos and create individual projects.</span>
            </span>
          </span>
          <span className="flex items-center gap-2 text-xs font-bold text-volt">
            {showBatchImport ? "Hide uploader" : "Add videos"}
            <span aria-hidden="true">{showBatchImport ? "−" : "↘"}</span>
          </span>
        </button>
        {showBatchImport ? (
          <div className="border-t border-white/10 p-3 md:p-5">
            <BulkCutUploader onCreated={refreshJobs} />
          </div>
        ) : null}
      </section>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-punch/40 bg-punch/10 px-4 py-3 text-sm text-punch">
          <span>{error}</span>
          <button type="button" onClick={() => void refreshJobs()} className="font-bold underline underline-offset-4">Retry</button>
        </div>
      ) : null}

      <section aria-labelledby="projects-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-ice">YOUR WORKSPACE</p>
            <h2 id="projects-title" className="display mt-2 text-4xl text-ink md:text-5xl">Projects</h2>
            <p className="mt-2 text-sm text-muted">
              {jobs === null ? "Loading your projects…" : `${visibleJobs.length} of ${jobs.length} projects`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/#studio" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-volt px-4 py-2 text-xs font-extrabold text-[#080b10] transition hover:bg-[#ddff83]">
              New cut <span aria-hidden="true">↗</span>
            </Link>
            <button
              type="button"
              onClick={() => void refreshJobs()}
              disabled={refreshing}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/15 bg-panel-raised px-3 py-2 text-xs font-bold text-ink transition hover:border-ice/50 disabled:opacity-60"
            >
              <span className={refreshing ? "animate-spin" : ""} aria-hidden="true">↻</span>
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-panel/80 p-3 md:p-4">
          <label className="relative block">
            <span className="sr-only">Search projects</span>
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted" aria-hidden="true">⌕</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search source, title, provider, or project ID…"
              className="min-h-11 w-full rounded-lg border border-white/12 bg-panel-inset py-2 pl-9 pr-3 text-sm text-ink placeholder:text-muted/60 focus:border-ice focus:outline-none"
            />
          </label>
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-2" aria-label="Filter projects">
              {filters.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={filter === item.value}
                  onClick={() => setFilter(item.value)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ${filter === item.value ? "border-volt bg-volt text-[#080b10]" : "border-white/12 bg-panel-raised text-muted hover:border-white/25 hover:text-ink"}`}
                >
                  {item.label}
                  <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${filter === item.value ? "bg-black/10" : "bg-black/20"}`}>{jobs === null ? "—" : item.count}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 xl:justify-end">
              <label className="flex items-center gap-2 text-xs text-muted">
                <span>Sort</span>
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortMode)}
                  className="min-h-9 rounded-lg border border-white/12 bg-panel-inset px-2.5 text-xs font-semibold text-ink"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="most-clips">Most clips</option>
                </select>
              </label>
              <div className="flex rounded-lg border border-white/12 bg-panel-inset p-1" role="group" aria-label="Project layout">
                {(["grid", "list"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={view === mode}
                    onClick={() => setView(mode)}
                    className={`rounded-md px-3 py-1.5 text-xs font-bold capitalize transition ${view === mode ? "bg-panel-raised text-volt shadow-sm" : "text-muted hover:text-ink"}`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {jobs === null ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading projects">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-56 animate-pulse rounded-xl border border-white/10 bg-panel" />
            ))}
          </div>
        ) : visibleJobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 bg-panel p-8 text-center md:p-12">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-white/12 bg-panel-raised font-mono text-2xl text-ice">⌕</span>
            <h3 className="display mt-5 text-3xl text-ink">{jobs.length === 0 ? "Your library is ready" : "No matching projects"}</h3>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
              {jobs.length === 0
                ? "Create your first cut from a video URL, or expand Batch import to add several videos."
                : "Try another search or switch to a different status filter."}
            </p>
            {jobs.length === 0 ? (
              <Link href="/#studio" className="mt-5 inline-flex min-h-10 items-center rounded-lg bg-volt px-4 py-2 text-xs font-extrabold text-[#080b10]">Create your first cut ↗</Link>
            ) : (
              <button type="button" onClick={() => { setSearch(""); setFilter("all"); }} className="mt-5 rounded-lg border border-white/15 px-4 py-2 text-xs font-bold text-ink hover:border-ice/50">Clear filters</button>
            )}
          </div>
        ) : (
          <ul className={view === "grid" ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-3"}>
            {visibleJobs.map((job) => {
              const firstClip = job.clips?.[0];
              const isDone = job.status === "done";
              const clipCount = job.clips?.length || 0;
              return (
                <li key={job.id} className="min-w-0">
                  <article className={`group flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-white/12 bg-panel transition hover:border-ice/40 hover:bg-panel-raised/70 ${view === "list" ? "md:flex-row" : ""}`}>
                    <div className={`relative shrink-0 overflow-hidden border-b border-white/10 bg-panel-inset ${view === "list" ? "aspect-[16/5] md:aspect-auto md:w-48 md:border-b-0 md:border-r" : "aspect-[16/7]"}`}>
                      <div className="absolute inset-0 z-10 flex flex-col justify-between p-4">
                        <div className="flex items-start justify-between gap-2">
                          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusClasses(job.status)}`}>
                            {statusLabel(job.status, job.progress)}
                          </span>
                          <span className="rounded-md border border-white/10 bg-black/45 px-2 py-1 font-mono text-[10px] text-muted">{job.vertical ? "9:16" : "SOURCE"}</span>
                        </div>
                        <div className="flex items-end justify-between gap-2">
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-[.17em] text-muted">Clipper project</p>
                            <p className="display mt-1 text-3xl text-ink">{String(clipCount).padStart(2, "0")} <span className="text-base text-muted">clips</span></p>
                          </div>
                          {firstClip ? <span className="rounded-lg border border-volt/30 bg-volt/10 px-2.5 py-2 font-mono text-sm font-bold text-volt">{firstClip.score}/100</span> : null}
                        </div>
                      </div>
                      {firstClip?.coverImage || firstClip?.id ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/jobs/${job.id}/clips/${firstClip.id}?cover=1`}
                            alt=""
                            aria-hidden="true"
                            loading="lazy"
                            className="absolute inset-0 z-0 h-full w-full object-cover opacity-35 transition duration-300 group-hover:scale-[1.02] group-hover:opacity-50"
                            onError={(event) => { event.currentTarget.style.display = "none"; }}
                          />
                        </>
                      ) : null}
                      {job.status === "running" || job.status === "queued" ? (
                        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
                          <div className="h-full bg-ice transition-all duration-500" style={{ width: `${Math.max(3, Math.min(100, job.progress * 100))}%` }} />
                        </div>
                      ) : null}
                    </div>

                    <div className={`flex min-w-0 flex-1 flex-col ${view === "list" ? "md:flex-row md:items-center" : ""}`}>
                      <Link href={`/jobs/${job.id}`} className="flex min-w-0 flex-1 flex-col p-4 outline-offset-[-3px]">
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted">
                          <span>{formatCreatedAt(job.createdAt)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{job.provider}</span>
                        </div>
                        <h3 className="mt-2 break-words text-base font-bold leading-snug text-ink transition group-hover:text-volt">
                          {firstClip?.title || (job.status === "error" ? "Processing failed" : job.status === "done" ? "Finished project" : "Finding the strongest moments…")}
                        </h3>
                        <p className="mt-2 line-clamp-2 break-words text-xs leading-relaxed text-muted">{job.source}</p>
                        {job.error ? <p className="mt-2 line-clamp-2 text-xs text-punch">{job.error}</p> : null}
                        <div className="mt-4 flex flex-wrap gap-1.5">
                          <span className="rounded border border-white/10 bg-panel-inset px-2 py-1 text-[10px] text-muted">{job.captions ? "Captions on" : "Captions off"}</span>
                          <span className="rounded border border-white/10 bg-panel-inset px-2 py-1 text-[10px] text-muted">{job.clipCount} requested</span>
                          {firstClip ? <span className="rounded border border-white/10 bg-panel-inset px-2 py-1 text-[10px] text-muted">{formatTimecode(firstClip.start)} start</span> : null}
                        </div>
                      </Link>
                      <div className={`flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3 ${view === "list" ? "md:w-36 md:flex-col md:items-stretch md:justify-center md:border-l md:border-t-0" : ""}`}>
                        <Link href={`/jobs/${job.id}`} className="text-xs font-bold text-ice transition hover:text-volt">Open project <span aria-hidden="true">↗</span></Link>
                        <button
                          type="button"
                          disabled={deletingId === job.id}
                          onClick={(event) => void handleDelete(event, job.id)}
                          className="rounded-md border border-white/10 px-2.5 py-1.5 text-[10px] font-bold text-muted transition hover:border-punch/40 hover:bg-punch/10 hover:text-punch disabled:opacity-50"
                        >
                          {deletingId === job.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
