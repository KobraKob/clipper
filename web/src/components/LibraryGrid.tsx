"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteJob, fetchJobs } from "@/lib/api";
import { formatTimecode } from "@/lib/pipeline";
import type { JobStatus, JobView } from "@/lib/types";
import { BulkCutUploader } from "@/components/BulkCutUploader";

type LibraryFilter = "all" | "ready" | "processing" | "failed";
type SortMode = "newest" | "oldest" | "most-clips" | "top-score";
type ViewMode = "grid" | "list";

const PREFS_KEY = "library:prefs";
const POLL_MS = 5000;

function isActive(status: JobStatus) {
  return status === "running" || status === "queued";
}

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

function timeAgo(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "Date unavailable";
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatCreatedAt(value);
}

function bestClip(job: JobView) {
  const clips = job.clips || [];
  if (clips.length === 0) return undefined;
  return clips.reduce((best, clip) => (clip.score > best.score ? clip : best), clips[0]);
}

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export function LibraryGrid() {
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBatchImport, setShowBatchImport] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<SortMode>(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(PREFS_KEY);
        if (raw) {
          const p = JSON.parse(raw) as { view?: ViewMode; sort?: SortMode };
          if (p.sort === "newest" || p.sort === "oldest" || p.sort === "most-clips" || p.sort === "top-score") {
            return p.sort;
          }
        }
      } catch {}
    }
    return "newest";
  });
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(PREFS_KEY);
        if (raw) {
          const p = JSON.parse(raw) as { view?: ViewMode; sort?: SortMode };
          if (p.view === "grid" || p.view === "list") return p.view;
        }
      } catch {}
    }
    return "grid";
  });

  const mounted = useRef(true);
  const loadInFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /* ---------- data ---------- */

  const load = useCallback(async (manual = false) => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    if (manual) setRefreshing(true);
    try {
      const next = await fetchJobs();
      if (!mounted.current) return;
      setJobs((current) =>
        current && JSON.stringify(current) === JSON.stringify(next) ? current : next
      );
      setError("");
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : "Could not load the library.");
    } finally {
      loadInFlight.current = false;
      if (manual && mounted.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasActive = useMemo(() => (jobs || []).some((job) => isActive(job.status)), [jobs]);

  useEffect(() => {
    if (!hasActive) return;
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [hasActive, load]);



  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ view, sort }));
    } catch {
      // storage unavailable
    }
  }, [view, sort]);

  /* ---------- tab title ---------- */

  const processingCount = useMemo(() => (jobs || []).filter((job) => isActive(job.status)).length, [jobs]);

  useEffect(() => {
    if (processingCount === 0) return;
    const previous = document.title;
    document.title = `${processingCount} processing · Library`;
    return () => {
      document.title = previous;
    };
  }, [processingCount]);

  /* ---------- derived ---------- */

  const counts = useMemo(() => {
    const all = jobs || [];
    return {
      all: all.length,
      ready: all.filter((job) => job.status === "done").length,
      processing: all.filter((job) => isActive(job.status)).length,
      failed: all.filter((job) => job.status === "error").length,
    };
  }, [jobs]);

  const visibleJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matchesFilter = (job: JobView) => {
      if (filter === "ready") return job.status === "done";
      if (filter === "processing") return isActive(job.status);
      if (filter === "failed") return job.status === "error";
      return true;
    };
    const topScore = (job: JobView) => (job.clips || []).reduce((max, clip) => Math.max(max, clip.score), 0);
    return [...(jobs || [])]
      .filter((job) => {
        if (!matchesFilter(job)) return false;
        if (!query) return true;
        const titles = (job.clips || []).map((clip) => clip.title || "");
        return [job.source, job.id, job.provider, job.error || "", ...titles].some((value) =>
          String(value).toLowerCase().includes(query),
        );
      })
      .sort((a, b) => {
        if (sort === "oldest") return a.createdAt - b.createdAt;
        if (sort === "most-clips") return (b.clips?.length || 0) - (a.clips?.length || 0) || b.createdAt - a.createdAt;
        if (sort === "top-score") return topScore(b) - topScore(a) || b.createdAt - a.createdAt;
        return b.createdAt - a.createdAt;
      });
  }, [jobs, search, filter, sort]);

  const selectedIds = useMemo(() => {
    const live = new Set((jobs || []).map((job) => job.id));
    return [...selected].filter((id) => live.has(id));
  }, [selected, jobs]);

  const allShownSelected = visibleJobs.length > 0 && visibleJobs.every((job) => selected.has(job.id));
  const filtersActive = search.trim() !== "" || filter !== "all";

  /* ---------- confirm timeouts ---------- */

  useEffect(() => {
    if (!confirmId && !confirmBulk) return;
    const timer = window.setTimeout(() => {
      setConfirmId(null);
      setConfirmBulk(false);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [confirmId, confirmBulk]);

  /* ---------- keyboard ---------- */

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (event.key === "g") setView("grid");
      else if (event.key === "l") setView("list");
      else if (event.key === "b") setShowBatchImport((v) => !v);
      else if (event.key === "r") void load(true);
      else if (event.key === "Escape") setSelected(new Set());
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load]);

  /* ---------- actions ---------- */

  function resetFilters() {
    setSearch("");
    setFilter("all");
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllShown() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allShownSelected) visibleJobs.forEach((job) => next.delete(job.id));
      else visibleJobs.forEach((job) => next.add(job.id));
      return next;
    });
  }

  async function removeJobs(ids: string[]) {
    setError("");
    setDeletingIds((prev) => new Set([...prev, ...ids]));
    const results = await Promise.allSettled(ids.map((id) => deleteJob(id)));
    if (!mounted.current) return;
    const removed = ids.filter((_, i) => results[i].status === "fulfilled");
    setJobs((prev) => (prev ? prev.filter((job) => !removed.includes(job.id)) : prev));
    setSelected((prev) => {
      const next = new Set(prev);
      removed.forEach((id) => next.delete(id));
      return next;
    });
    setDeletingIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    const failed = ids.length - removed.length;
    if (failed > 0) {
      const firstFailure = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      const reason = firstFailure?.reason instanceof Error ? ` ${firstFailure.reason.message}` : "";
      setError(`${failed} of ${ids.length} could not be deleted.${reason}`);
    }
  }

  function handleDelete(event: React.MouseEvent<HTMLButtonElement>, jobId: string) {
    event.preventDefault();
    event.stopPropagation();
    if (confirmId !== jobId) {
      setConfirmId(jobId);
      return;
    }
    setConfirmId(null);
    void removeJobs([jobId]);
  }

  function handleBulkDelete() {
    if (!confirmBulk) {
      setConfirmBulk(true);
      return;
    }
    setConfirmBulk(false);
    void removeJobs(selectedIds);
  }

  /* ---------- static config ---------- */

  const tiles: { value: LibraryFilter; label: string; count: number; accent: string }[] = [
    { value: "all", label: "All projects", count: counts.all, accent: "text-ink" },
    { value: "ready", label: "Ready to review", count: counts.ready, accent: "text-volt" },
    { value: "processing", label: "In progress", count: counts.processing, accent: "text-ice" },
    { value: "failed", label: "Needs attention", count: counts.failed, accent: "text-punch" },
  ];

  /* ---------- render ---------- */

  return (
    <div className="library-workspace flex flex-col gap-6">
      {/* overview doubles as the status filter */}
      <section className="library-overview stamp-sm overflow-hidden rounded-xl border border-white/12 bg-panel" aria-label="Filter by status">
        <div className="grid grid-cols-2 divide-x divide-y divide-white/10 md:grid-cols-4 md:divide-y-0">
          {tiles.map((tile) => {
            const active = filter === tile.value;
            return (
              <button
                key={tile.value}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(tile.value)}
                className={`relative cursor-pointer px-4 py-4 text-left transition md:px-5 md:py-5 ${tile.accent} ${
                  active ? "bg-panel-raised" : "hover:bg-panel-raised/60"
                }`}
              >
                <p className="text-[10px] font-bold uppercase tracking-[.13em] text-muted">{tile.label}</p>
                <p className="mt-2 font-mono text-3xl font-bold tabular-nums">{jobs === null ? "—" : tile.count}</p>
                {active ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-current" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </section>

      {/* batch import */}
      <section className="library-import-panel overflow-hidden rounded-xl border border-white/12 bg-panel">
        <button
          type="button"
          aria-expanded={showBatchImport}
          onClick={() => setShowBatchImport((current) => !current)}
          className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 bg-panel-raised px-4 py-4 text-left transition hover:bg-panel md:px-5"
        >
          <span className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg border border-volt/30 bg-volt/10 font-mono text-lg font-bold text-volt">
              +
            </span>
            <span>
              <strong className="block text-sm text-ink">Batch import</strong>
              <span className="mt-1 block text-xs text-muted">Upload multiple videos and create individual projects.</span>
            </span>
          </span>
          <span className="flex items-center gap-2 text-xs font-bold text-volt">
            {showBatchImport ? "Hide uploader" : "Add videos"}
            <kbd className="rounded border border-volt/40 px-1.5 py-0.5 font-mono text-[10px]">B</kbd>
          </span>
        </button>
        {showBatchImport ? (
          <div className="border-t border-white/10 p-3 md:p-5">
            <BulkCutUploader onCreated={() => void load(true)} />
          </div>
        ) : null}
      </section>

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-punch/40 bg-punch/10 px-4 py-3 text-sm text-punch"
        >
          <span>{error}</span>
          <span className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => void load(true)}
              className="cursor-pointer font-bold underline underline-offset-4"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => setError("")}
              aria-label="Dismiss error"
              className="cursor-pointer font-mono hover:text-white"
            >
              ✕
            </button>
          </span>
        </div>
      ) : null}

      <section aria-labelledby="projects-title" className="library-projects flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-ice">Your workspace</p>
            <h2 id="projects-title" className="display mt-1 text-4xl text-ink md:text-5xl">
              Projects
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {hasActive ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-ice/30 bg-ice/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ice">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ice" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-ice" />
                </span>
                Live
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-white/15 bg-panel-raised px-3 py-2 text-xs font-bold text-ink transition hover:border-ice/50 disabled:opacity-60"
            >
              <span className={refreshing ? "animate-spin" : ""} aria-hidden="true">
                ↻
              </span>
              {refreshing ? "Refreshing" : "Refresh"}
              <kbd className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-muted">R</kbd>
            </button>
          </div>
        </div>

        {/* toolbar */}
        <div className="library-toolbar sticky top-0 z-20 flex flex-col gap-3 rounded-xl border border-white/10 bg-panel p-3 md:p-4">
          <label className="relative block">
            <span className="sr-only">Search projects</span>
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted" aria-hidden="true">
              ⌕
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSearch("");
                  event.currentTarget.blur();
                }
              }}
              placeholder="Search source, clip title, provider or project ID"
              className="min-h-11 w-full rounded-lg border border-white/12 bg-panel-inset py-2 pl-9 pr-12 text-sm text-ink placeholder:text-muted/60 focus:border-ice focus:outline-none"
            />
            <kbd className="pointer-events-none absolute inset-y-0 right-3 my-auto hidden h-6 items-center rounded border border-white/15 px-1.5 font-mono text-[10px] text-muted md:flex">
              /
            </kbd>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-muted">
              <span>Sort</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortMode)}
                className="min-h-9 cursor-pointer rounded-lg border border-white/12 bg-panel-inset px-2.5 text-xs font-semibold text-ink focus:border-ice focus:outline-none"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="most-clips">Most clips</option>
                <option value="top-score">Highest scoring clip</option>
              </select>
            </label>
            <div className="flex rounded-lg border border-white/12 bg-panel-inset p-1" role="group" aria-label="Project layout">
              {(["grid", "list"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                  className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-bold capitalize transition ${
                    view === mode ? "bg-panel-raised text-volt" : "text-muted hover:text-ink"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
            <p className="text-xs text-muted" aria-live="polite">
              {jobs === null ? (
                "Loading projects"
              ) : (
                <>
                  Showing <span className="font-bold text-ink">{visibleJobs.length}</span> of {jobs.length}
                </>
              )}
              {filtersActive ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="ml-3 cursor-pointer font-bold text-ice transition hover:text-ink"
                >
                  Clear filters
                </button>
              ) : null}
            </p>

            {visibleJobs.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {selectedIds.length > 0 ? (
                  <>
                    <span className="font-mono text-xs font-bold text-volt">{selectedIds.length} selected</span>
                    <button
                      type="button"
                      onClick={() => setSelected(new Set())}
                      className="cursor-pointer rounded-lg border border-white/15 bg-panel-raised px-3 py-1.5 text-xs font-bold text-muted transition hover:text-ink"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={handleBulkDelete}
                      disabled={selectedIds.some((id) => deletingIds.has(id))}
                      className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
                        confirmBulk
                          ? "border-punch bg-punch text-white"
                          : "border-punch/40 bg-punch/10 text-punch hover:bg-punch hover:text-white"
                      }`}
                    >
                      {confirmBulk ? `Click again to delete ${selectedIds.length}` : "Delete selected"}
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={toggleAllShown}
                  className="cursor-pointer rounded-lg border border-white/15 bg-panel-raised px-3 py-1.5 text-xs font-bold text-ink transition hover:border-ice/50"
                >
                  {allShownSelected ? "Deselect shown" : "Select shown"}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* results */}
        {jobs === null && !error ? (
          <div
            className={view === "grid" ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-3"}
            aria-busy="true"
            aria-label="Loading projects"
          >
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className={`animate-pulse rounded-xl border border-white/10 bg-panel ${view === "grid" ? "h-64" : "h-32"}`}
              />
            ))}
          </div>
        ) : jobs !== null && visibleJobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 bg-panel p-8 text-center md:p-12">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-white/12 bg-panel-raised font-mono text-2xl text-ice">
              {jobs.length === 0 ? "+" : "⌕"}
            </span>
            <h3 className="display mt-5 text-3xl text-ink">
              {jobs.length === 0 ? "No projects yet" : "No matching projects"}
            </h3>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
              {jobs.length === 0
                ? "Create a cut from a video URL, or open Batch import to add several videos at once."
                : "Nothing fits the current search and status filter."}
            </p>
            {jobs.length === 0 ? (
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="/#studio"
                  className="inline-flex min-h-10 items-center rounded-lg bg-volt px-4 py-2 text-xs font-extrabold text-[#080b10] transition hover:bg-[#a5b4fc]"
                >
                  Create a cut
                </Link>
                <button
                  type="button"
                  onClick={() => setShowBatchImport(true)}
                  className="cursor-pointer rounded-lg border border-white/15 px-4 py-2 text-xs font-bold text-ink transition hover:border-ice/50"
                >
                  Open batch import
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={resetFilters}
                className="mt-5 cursor-pointer rounded-lg border border-white/15 px-4 py-2 text-xs font-bold text-ink transition hover:border-ice/50"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : jobs !== null ? (
          <ul className={view === "grid" ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-3"}>
            {visibleJobs.map((job) => {
              const top = bestClip(job);
              const clipCount = job.clips?.length || 0;
              const keptCount = (job.clips || []).filter((clip) => clip.kept).length;
              const active = isActive(job.status);
              const isSelected = selected.has(job.id);
              const isDeleting = deletingIds.has(job.id);
              const confirming = confirmId === job.id;
              return (
                <li key={job.id} className="min-w-0">
                  <article
                    className={`group flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-panel transition ${
                      isSelected ? "border-volt" : "border-white/12 hover:border-ice/40 hover:bg-panel-raised/70"
                    } ${isDeleting ? "pointer-events-none opacity-50" : ""} ${view === "list" ? "md:flex-row" : ""}`}
                  >
                    <div
                      className={`relative shrink-0 overflow-hidden border-b border-white/10 bg-panel-inset ${
                        view === "list" ? "aspect-[16/5] md:aspect-auto md:w-52 md:border-b-0 md:border-r" : "aspect-[16/7]"
                      }`}
                    >
                      <div className="absolute inset-0 z-10 flex flex-col justify-between p-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <label
                              className="flex cursor-pointer items-center rounded-md border border-white/15 bg-black/55 p-1.5"
                              title="Select project"
                            >
                              <span className="sr-only">Select project {job.id}</span>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelected(job.id)}
                                className="h-4 w-4 cursor-pointer accent-volt"
                              />
                            </label>
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusClasses(job.status)}`}
                            >
                              {active ? (
                                <span className="relative flex h-1.5 w-1.5">
                                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current" />
                                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
                                </span>
                              ) : null}
                              {statusLabel(job.status, job.progress)}
                            </span>
                          </div>
                          <span className="rounded-md border border-white/10 bg-black/55 px-2 py-1 font-mono text-[10px] text-muted">
                            {job.vertical ? "9:16" : "SOURCE"}
                          </span>
                        </div>
                        <div className="flex items-end justify-between gap-2">
                          <p className="display text-3xl text-ink">
                            {String(clipCount).padStart(2, "0")} <span className="text-base text-muted">clips</span>
                          </p>
                          {top ? (
                            <span className="rounded-lg border border-volt/30 bg-volt/10 px-2.5 py-2 font-mono text-sm font-bold text-volt">
                              {top.score}/100
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {top?.coverImage || top?.id ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/jobs/${job.id}/clips/${top.id}?cover=1`}
                            alt=""
                            aria-hidden="true"
                            loading="lazy"
                            className="absolute inset-0 z-0 h-full w-full object-cover opacity-35 transition duration-300 group-hover:scale-[1.02] group-hover:opacity-50"
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                        </>
                      ) : null}
                      {active ? (
                        <div className="absolute inset-x-0 bottom-0 z-10 h-1 bg-white/10">
                          <div
                            className="h-full bg-ice transition-all duration-500"
                            style={{ width: `${Math.max(3, Math.min(100, job.progress * 100))}%` }}
                          />
                        </div>
                      ) : null}
                    </div>

                    <div className={`flex min-w-0 flex-1 flex-col ${view === "list" ? "md:flex-row md:items-center" : ""}`}>
                      <Link href={`/jobs/${job.id}`} className="flex min-w-0 flex-1 flex-col p-4 outline-offset-[-3px]">
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted">
                          <time dateTime={new Date(job.createdAt).toISOString()} title={formatCreatedAt(job.createdAt)}>
                            {timeAgo(job.createdAt)}
                          </time>
                          <span aria-hidden="true">·</span>
                          <span>{job.provider}</span>
                        </div>
                        <h3 className="mt-2 break-words text-base font-bold leading-snug text-ink transition group-hover:text-volt">
                          {top?.title ||
                            (job.status === "error"
                              ? "Processing failed"
                              : job.status === "done"
                              ? "Finished project"
                              : job.status === "queued"
                              ? "Waiting in queue"
                              : "Finding the strongest moments")}
                        </h3>
                        <p className="mt-2 line-clamp-2 break-all text-xs leading-relaxed text-muted">{job.source}</p>
                        {job.status === "running" && job.progressMessage ? (
                          <p className="mt-2 line-clamp-1 font-mono text-xs font-semibold text-ice">{job.progressMessage}</p>
                        ) : null}
                        {job.error ? <p className="mt-2 line-clamp-2 text-xs text-punch">{job.error}</p> : null}
                        <div className="mt-4 flex flex-wrap gap-1.5">
                          {job.status === "done" && clipCount > 0 ? (
                            <span
                              className={`rounded border px-2 py-1 text-[10px] font-semibold ${
                                keptCount > 0
                                  ? "border-volt/30 bg-volt/10 text-volt"
                                  : "border-white/10 bg-panel-inset text-muted"
                              }`}
                            >
                              {keptCount}/{clipCount} kept
                            </span>
                          ) : (
                            <span className="rounded border border-white/10 bg-panel-inset px-2 py-1 text-[10px] text-muted">
                              {job.clipCount} requested
                            </span>
                          )}
                          <span className="rounded border border-white/10 bg-panel-inset px-2 py-1 text-[10px] text-muted">
                            {job.captions ? "Captions on" : "Captions off"}
                          </span>
                          {top ? (
                            <span className="rounded border border-white/10 bg-panel-inset px-2 py-1 font-mono text-[10px] text-muted">
                              Top clip at {formatTimecode(top.start)}
                            </span>
                          ) : null}
                        </div>
                      </Link>
                      <div
                        className={`flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3 ${
                          view === "list" ? "md:w-40 md:flex-col md:items-stretch md:justify-center md:border-l md:border-t-0" : ""
                        }`}
                      >
                        <Link href={`/jobs/${job.id}`} className="text-xs font-bold text-ice transition hover:text-volt">
                          {job.status === "error" ? "View error" : job.status === "done" ? "Review clips" : "Watch progress"}
                        </Link>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={(event) => handleDelete(event, job.id)}
                          className={`cursor-pointer rounded-md border px-2.5 py-1.5 text-[10px] font-bold transition disabled:opacity-50 ${
                            confirming
                              ? "border-punch bg-punch text-white"
                              : "border-white/10 text-muted hover:border-punch/40 hover:bg-punch/10 hover:text-punch"
                          }`}
                        >
                          {isDeleting ? "Deleting" : confirming ? "Confirm delete" : "Delete"}
                        </button>
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        ) : null}

        <p className="hidden px-1 text-[11px] leading-relaxed text-muted md:block">
          Shortcuts:{" "}
          {[
            ["/", "search"],
            ["N", "new cut"],
            ["P", "calendar"],
            ["G", "grid"],
            ["L", "list"],
            ["B", "batch import"],
            ["R", "refresh"],
            ["Esc", "clear selection"],
          ].map(([k, l]) => (
            <span key={k} className="mr-3 whitespace-nowrap">
              <kbd className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-ink">{k}</kbd> {l}
            </span>
          ))}
        </p>
      </section>
    </div>
  );
}