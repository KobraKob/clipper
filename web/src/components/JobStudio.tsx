"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteJob, fetchJob, fetchJobLogs, fetchJobStatus, patchClip, rerenderClip } from "@/lib/api";
import { formatTimecode } from "@/lib/pipeline";
import type { JobView } from "@/lib/types";
import { ClipCard } from "./ClipCard";
import { PipelineStrip } from "./PipelineStrip";
import { WaveBars } from "./WaveBars";

type Filter = "all" | "kept" | "dropped";
type Sort = "score" | "start" | "duration";
type View = "grid" | "list";

const PREFS_KEY = "jobstudio:prefs";

function formatRuntime(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function preserveUnchangedClipReferences(
  current: JobView | null,
  next: JobView,
): JobView {
  if (!current || current.id !== next.id) return next;
  if (JSON.stringify(current) === JSON.stringify(next)) return current;

  const previousById = new Map(current.clips.map((clip) => [clip.id, clip]));
  let reusedAny = false;
  const clips = next.clips.map((clip) => {
    const previous = previousById.get(clip.id);
    if (previous && JSON.stringify(previous) === JSON.stringify(clip)) {
      reusedAny = true;
      return previous;
    }
    return clip;
  });

  return reusedAny ? { ...next, clips } : next;
}

export function JobStudio({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyClipIds, setBusyClipIds] = useState<Set<string>>(new Set());
  const [bulkLabel, setBulkLabel] = useState("");
  const [logs, setLogs] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [clipSearch, setClipSearch] = useState("");
  const [clipFilter, setClipFilter] = useState<Filter>("all");
  const [clipSort, setClipSort] = useState<Sort>(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(PREFS_KEY);
        if (raw) {
          const p = JSON.parse(raw) as { view?: View; sort?: Sort };
          if (p.sort === "score" || p.sort === "start" || p.sort === "duration") return p.sort;
        }
      } catch {}
    }
    return "score";
  });
  const [clipView, setClipView] = useState<View>(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(PREFS_KEY);
        if (raw) {
          const p = JSON.parse(raw) as { view?: View; sort?: Sort };
          if (p.view === "grid" || p.view === "list") return p.view;
        }
      } catch {}
    }
    return "grid";
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const stickToBottom = useRef(true);
  const refreshInFlight = useRef(false);

  /* ---------- data ---------- */

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const status = await fetchJobStatus(jobId);
      if (status.status !== "running") {
        const next = await fetchJob(jobId);
        setJob((current) => preserveUnchangedClipReferences(current, next));
      } else {
        setJob((current) => {
          if (!current) return current;
          if (
            current.status === status.status &&
            current.stageIndex === status.stageIndex &&
            current.stageId === status.stageId &&
            current.progress === status.progress &&
            current.progressMessage === status.progressMessage &&
            current.error === status.error
          ) {
            return current;
          }
          return {
            ...current,
            status: status.status,
            stageIndex: status.stageIndex,
            stageId: status.stageId,
            progress: status.progress,
            progressMessage: status.progressMessage,
            error: status.error,
          };
        });
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this job.");
    } finally {
      refreshInFlight.current = false;
    }
  }, [jobId]);

  useEffect(() => {
    let ignore = false;
    async function initJob() {
      try {
        const next = await fetchJob(jobId);
        if (!ignore) {
          setJob((current) => preserveUnchangedClipReferences(current, next));
          setError("");
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Could not load this job.");
        }
      }
    }
    void initJob();
    return () => {
      ignore = true;
    };
  }, [jobId]);

  const isRunning = job?.status === "running";

  useEffect(() => {
    if (!isRunning) return;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(tick, 2000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [isRunning, refresh]);

  useEffect(() => {
    let ignore = false;
    let loading = false;
    async function loadLogs() {
      if (loading) return;
      loading = true;
      try {
        const res = await fetchJobLogs(jobId);
        if (ignore) return;
        const nextLogs = res.logs || "";
        setLogs((current) => current === nextLogs ? current : nextLogs);
        if (res.status === "error") setShowLogs(true);
      } catch {
        // logs endpoint unavailable or job deleted
      } finally {
        loading = false;
      }
    }
    void loadLogs();
    if (!isRunning && !showLogs) {
      return () => {
        ignore = true;
      };
    }
    const tick = () => {
      if (document.visibilityState === "visible") void loadLogs();
    };
    const timer = window.setInterval(tick, 4000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      ignore = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [jobId, isRunning, showLogs]);



  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ view: clipView, sort: clipSort }));
    } catch {
      // storage unavailable
    }
  }, [clipView, clipSort]);

  /* ---------- tab title ---------- */

  useEffect(() => {
    const previous = document.title;
    if (job?.status === "running") document.title = `${Math.round(job.progress * 100)}% · Cutting…`;
    else if (job?.status === "error") document.title = "Cut failed";
    else if (job?.status === "done") document.title = `${job.clips.length} clips ready`;
    return () => {
      document.title = previous;
    };
  }, [job?.status, job?.progress, job?.clips.length]);

  /* ---------- log autoscroll ---------- */

  useEffect(() => {
    const el = logRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [logs, showLogs]);

  /* ---------- keyboard shortcuts ---------- */

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "g") setClipView("grid");
      else if (event.key === "l") setClipView("list");
      else if (event.key === "c") setShowLogs((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!confirmDelete) return;
    const t = window.setTimeout(() => setConfirmDelete(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmDelete]);

  /* ---------- derived ---------- */

  const clips = useMemo(() => job?.clips ?? [], [job]);
  const kept = useMemo(() => clips.filter((c) => c.kept), [clips]);
  const dropped = clips.length - kept.length;
  const keptRuntime = useMemo(() => kept.reduce((sum, c) => sum + (c.end - c.start), 0), [kept]);

  const visibleClips = useMemo(() => {
    const query = clipSearch.trim().toLowerCase();
    return clips
      .filter((clip) => {
        if (clipFilter === "kept" && !clip.kept) return false;
        if (clipFilter === "dropped" && clip.kept) return false;
        if (!query) return true;
        return [clip.title, clip.hook, clip.reason, clip.text, clip.id].some((v) =>
          String(v || "").toLowerCase().includes(query),
        );
      })
      .sort((a, b) => {
        if (clipSort === "start") return a.start - b.start;
        if (clipSort === "duration") return b.end - b.start - (a.end - a.start);
        return b.score - a.score;
      });
  }, [clips, clipFilter, clipSearch, clipSort]);

  const keptByTime = useMemo(() => [...kept].sort((a, b) => a.start - b.start), [kept]);
  const filtersActive = clipSearch.trim() !== "" || clipFilter !== "all";

  /* ---------- actions ---------- */

  function setClipBusy(clipId: string, isBusy: boolean) {
    setBusyClipIds((current) => {
      if (current.has(clipId) === isBusy) return current;
      const next = new Set(current);
      if (isBusy) next.add(clipId);
      else next.delete(clipId);
      return next;
    });
  }

  async function updateClip(clipId: string, patch: { kept?: boolean; start?: number; end?: number }) {
    setClipBusy(clipId, true);
    try {
      const next = await patchClip(jobId, clipId, patch);
      setJob((current) => preserveUnchangedClipReferences(current, next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update clip.");
    } finally {
      setClipBusy(clipId, false);
    }
  }

  async function handleRerender(
    clipId: string,
    start: number,
    end: number,
    captionStyle?: string,
    template?: import("@/lib/types").SocialTemplate,
    templateDisplayName?: string,
    templateHandle?: string,
  ) {
    setClipBusy(clipId, true);
    try {
      const next = await rerenderClip(
        jobId,
        clipId,
        start,
        end,
        captionStyle,
        template,
        templateDisplayName,
        templateHandle,
      );
      setJob((current) => preserveUnchangedClipReferences(current, next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not re-render clip.");
      throw err;
    } finally {
      setClipBusy(clipId, false);
    }
  }

  async function bulkSetKept(keptNext: boolean) {
    const targets = visibleClips.filter((c) => c.kept !== keptNext);
    if (targets.length === 0) return;
    setBusy(true);
    try {
      let latest: JobView | null = null;
      for (let i = 0; i < targets.length; i++) {
        setBulkLabel(`${i + 1}/${targets.length}`);
        latest = await patchClip(jobId, targets[i].id, { kept: keptNext });
      }
      if (latest) setJob((current) => preserveUnchangedClipReferences(current, latest));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk update failed.");
      void refresh();
    } finally {
      setBulkLabel("");
      setBusy(false);
    }
  }

  async function handleDeleteJob() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    try {
      await deleteJob(jobId);
      router.push("/library");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete cut.");
      setConfirmDelete(false);
      setBusy(false);
    }
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied((c) => (c === label ? "" : c)), 1500);
    } catch {
      setError("Clipboard access is unavailable in this browser context.");
    }
  }

  function resetFilters() {
    setClipSearch("");
    setClipFilter("all");
  }

  function jumpToClip(id: string) {
    const go = () =>
      document.getElementById(`clip-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (!document.getElementById(`clip-${id}`)) {
      resetFilters();
      window.setTimeout(go, 60);
    } else go();
  }

  /* ---------- early states ---------- */

  if (error && !job) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 py-16">
        <p role="alert" className="rounded-lg border border-punch/60 bg-punch/15 px-4 py-3 font-semibold text-punch">
          {error}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => void refresh()}
            className="cursor-pointer rounded-lg border border-white/20 bg-panel px-4 py-2 font-semibold text-ink transition hover:bg-panel-raised"
          >
            Retry
          </button>
          <Link href="/" className="rounded-lg bg-volt px-4 py-2 font-bold text-white transition hover:bg-[#a5b4fc]">
            ← Back to New Cut
          </Link>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex flex-col gap-4 py-12" aria-busy="true" aria-live="polite">
        <div className="h-10 w-64 animate-pulse rounded-lg bg-panel-raised" />
        <div className="h-24 w-full animate-pulse rounded-xl bg-panel" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-panel" />
          ))}
        </div>
        <span className="sr-only">Loading the cut…</span>
      </div>
    );
  }

  const running = job.status === "running";
  const failed = job.status === "error";
  const done = job.status === "done";
  const pct = Math.round(job.progress * 100);

  const statusChip = running
    ? { label: `Cutting · ${pct}%`, dot: "bg-volt animate-ping", box: "border-volt/40 bg-volt/10 text-volt" }
    : failed
    ? { label: "Failed", dot: "bg-punch", box: "border-punch/40 bg-punch/10 text-punch" }
    : { label: "Ready", dot: "bg-ice", box: "border-ice/40 bg-ice/10 text-ice" };

  const stats: [string, string][] = [
    ["Provider", job.provider],
    ["Clips", String(job.clipCount)],
    ["Frame", job.vertical ? "9:16" : "Source"],
    ["Captions", job.captions ? "Burned in" : "Off"],
  ];

  /* ---------- render ---------- */

  return (
    <div className="job-workspace flex flex-col gap-6">
      {/* header */}
      <header className="job-workspace-head flex flex-col gap-4">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 font-mono text-xs text-muted">
          <Link href="/library" className="transition hover:text-ink">
            Library
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-ink">{jobId.slice(0, 8)}</span>
        </nav>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="display text-5xl text-ink md:text-6xl">This cut</h1>
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider ${statusChip.box}`}
                role="status"
              >
                <span className="relative flex h-2 w-2">
                  <span className={`absolute inline-flex h-full w-full rounded-full ${statusChip.dot}`} />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
                </span>
                {statusChip.label}
              </span>
            </div>
            <button
              type="button"
              onClick={() => copy("source", job.source)}
              title="Click to copy source"
              className="mt-3 flex max-w-full cursor-pointer items-center gap-2 rounded-lg border border-white/12 bg-panel-raised px-3 py-2 text-left font-mono text-xs text-muted transition hover:border-white/25 hover:text-ink"
            >
              <span className="shrink-0 rounded bg-panel-inset px-1.5 py-0.5 font-bold uppercase text-ice">
                {job.sourceKind === "url" ? "URL" : "File"}
              </span>
              <span className="truncate">{job.source}</span>
              <span className="shrink-0 font-bold text-volt">{copied === "source" ? "Copied" : "Copy"}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="stamp-sm rounded-lg border border-white/20 bg-panel px-4 py-2 font-semibold text-ink transition hover:bg-panel-raised"
            >
              + New cut
            </Link>
            <Link
              href="/library"
              className="stamp-sm rounded-lg border border-volt bg-volt px-4 py-2 font-bold text-white transition hover:bg-[#a5b4fc]"
            >
              Library
            </Link>
            <button
              type="button"
              onClick={handleDeleteJob}
              disabled={busy || busyClipIds.size > 0}
              className={`stamp-sm cursor-pointer rounded-lg border px-4 py-2 font-semibold transition disabled:opacity-60 ${
                confirmDelete
                  ? "border-punch bg-punch text-white"
                  : "border-punch/40 bg-punch/10 text-punch hover:bg-punch hover:text-white"
              }`}
            >
              {confirmDelete ? "Click again to delete" : "Delete"}
            </button>
          </div>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-4 rounded-lg border border-punch/60 bg-punch/15 px-4 py-3 font-semibold text-punch"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setError("")}
            aria-label="Dismiss error"
            className="cursor-pointer font-mono text-sm hover:text-white"
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* pipeline */}
      <section aria-label="Pipeline status" className="job-pipeline stamp-sm rounded-xl border border-white/15 bg-panel p-4 md:p-5">
        <PipelineStrip stageId={job.stageId} progress={job.progress} />
        {running ? (
          <div className="mt-4 flex flex-col gap-3">
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-panel-inset"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full rounded-full bg-volt transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            {job.progressMessage ? (
              <p className="rounded-lg border border-white/10 bg-panel-inset p-3 font-mono text-sm font-semibold text-volt">
                {job.progressMessage}
              </p>
            ) : null}
            <WaveBars live={running} />
          </div>
        ) : null}
      </section>

      {/* failure */}
      {failed ? (
        <section role="alert" className="stamp-sm flex flex-col gap-4 rounded-xl border border-punch/60 bg-punch/10 p-6">
          <div className="flex items-center gap-3">
            <span className="rounded bg-punch px-2 py-1 text-xs font-bold uppercase text-white">Cut failed</span>
            <h2 className="display text-3xl text-punch">Processing error</h2>
          </div>
          <div className="break-words rounded-lg border border-punch/40 bg-panel-inset p-4 font-mono text-sm text-ink">
            {job.error || job.progressMessage || "An unexpected error occurred during processing."}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setShowLogs(true)}
              className="stamp-sm cursor-pointer rounded-lg bg-volt px-4 py-2 font-bold text-white transition hover:bg-[#a5b4fc]"
            >
              Open console
            </button>
            <Link
              href="/"
              className="stamp-sm rounded-lg border border-white/20 bg-panel px-4 py-2 font-bold text-ink transition hover:bg-panel-raised"
            >
              Start new cut
            </Link>
          </div>
        </section>
      ) : null}

      {done && clips.length === 0 ? (
        <section className="stamp-sm rounded-xl border border-white/15 bg-panel p-8 text-center">
          <p className="display text-3xl text-volt">No clips generated</p>
          <p className="mx-auto mt-2 max-w-md text-muted">
            The video was processed, but no segment cleared the score and duration thresholds. Try a longer source or a
            different provider.
          </p>
        </section>
      ) : null}

      {/* workspace */}
      <div className="job-editor-layout grid items-start gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        {/* sidebar */}
        <aside className="job-editor-sidebar flex flex-col gap-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1">
          <dl className="grid grid-cols-2 gap-2">
            {stats.map(([label, value]) => (
              <div key={label} className="stamp-sm rounded-lg border border-white/12 bg-panel p-3">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
                <dd className="display mt-1 truncate text-2xl text-volt">{value}</dd>
              </div>
            ))}
          </dl>

          {done && clips.length > 0 ? (
            <section className="rounded-xl border border-white/12 bg-panel p-4" aria-label="Selection summary">
              <p className="text-[10px] font-bold uppercase tracking-[.16em] text-ice">Selection</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-volt/25 bg-volt/10 py-2">
                  <p className="display text-2xl text-volt">{kept.length}</p>
                  <p className="text-[10px] font-semibold uppercase text-muted">Kept</p>
                </div>
                <div className="rounded-lg border border-white/12 bg-panel-inset py-2">
                  <p className="display text-2xl text-ink">{dropped}</p>
                  <p className="text-[10px] font-semibold uppercase text-muted">Dropped</p>
                </div>
                <div className="rounded-lg border border-white/12 bg-panel-inset py-2">
                  <p className="display text-2xl text-ink">{formatRuntime(keptRuntime)}</p>
                  <p className="text-[10px] font-semibold uppercase text-muted">Runtime</p>
                </div>
              </div>

              {keptByTime.length > 0 ? (
                <>
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted">Kept clips by timeline</p>
                    <button
                      type="button"
                      onClick={() =>
                        copy("times", keptByTime.map((c) => `${formatTimecode(c.start)} ${c.title || c.id}`).join("\n"))
                      }
                      className="cursor-pointer text-xs font-bold text-volt transition hover:text-ink"
                    >
                      {copied === "times" ? "Copied" : "Copy list"}
                    </button>
                  </div>
                  <ol className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
                    {keptByTime.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => jumpToClip(c.id)}
                          className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left transition hover:bg-panel-raised"
                        >
                          <span className="shrink-0 font-mono text-xs font-bold text-ice">{formatTimecode(c.start)}</span>
                          <span className="truncate text-xs text-ink">{c.title || c.id}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className="mt-4 text-xs text-muted">Nothing kept yet. Keep a clip to see it here.</p>
              )}
            </section>
          ) : null}

          {/* console */}
          <section className="stamp-sm overflow-hidden rounded-xl border border-white/15 bg-panel">
            <button
              type="button"
              onClick={() => setShowLogs((v) => !v)}
              aria-expanded={showLogs}
              className="flex w-full cursor-pointer items-center justify-between bg-panel-raised p-3.5 text-left transition hover:bg-panel"
            >
              <span className="flex items-center gap-2.5">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${running ? "bg-volt animate-ping" : failed ? "bg-punch" : "bg-ice"}`}
                />
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-ink">Console</span>
              </span>
              <span className="flex items-center gap-2 font-mono text-xs text-muted">
                <kbd className="rounded border border-white/15 px-1.5 py-0.5 text-[10px]">C</kbd>
                {showLogs ? "▲" : "▼"}
              </span>
            </button>
            {showLogs ? (
              <div className="flex flex-col gap-2 bg-[#0a0a0e] p-3 font-mono text-xs">
                <div className="flex items-center justify-between border-b border-white/10 pb-2 text-[11px] text-muted">
                  <span className="truncate">workdir/{jobId}/clipper.log</span>
                  <button
                    type="button"
                    onClick={() => copy("logs", logs)}
                    className="cursor-pointer font-bold transition hover:text-volt"
                  >
                    {copied === "logs" ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre
                  ref={logRef}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
                  }}
                  className="max-h-72 select-text overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-white/5 bg-[#0e0e14] p-3 leading-relaxed text-gray-300"
                >
                  {logs || "Waiting for process output…"}
                </pre>
              </div>
            ) : null}
          </section>

          <p className="hidden px-1 text-[11px] leading-relaxed text-muted xl:block">
            Shortcuts:{" "}
            {[
              ["/", "search"],
              ["G", "grid"],
              ["L", "list"],
              ["C", "console"],
            ].map(([k, l]) => (
              <span key={k} className="mr-2 whitespace-nowrap">
                <kbd className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-ink">{k}</kbd> {l}
              </span>
            ))}
          </p>
        </aside>

        {/* clips */}
        <main className="job-editor-main flex min-w-0 flex-col gap-4">
          {done && clips.length > 0 ? (
            <section className="flex flex-col gap-4" aria-labelledby="clip-review-title">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.16em] text-ice">Review workspace</p>
                <h2 id="clip-review-title" className="display mt-1 text-4xl text-ink md:text-5xl">
                  Your clips<span className="text-volt">.</span>
                </h2>
                <p className="mt-1 text-sm text-muted">Every change saves to this project automatically.</p>
              </div>

              {/* toolbar */}
              <div className="job-editor-toolbar sticky top-0 z-10 flex flex-col gap-3 rounded-xl border border-white/10 bg-panel p-3 md:p-4">
                <label className="relative block">
                  <span className="sr-only">Search clips</span>
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted" aria-hidden="true">
                    ⌕
                  </span>
                  <input
                    ref={searchRef}
                    type="search"
                    value={clipSearch}
                    onChange={(e) => setClipSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setClipSearch("");
                        e.currentTarget.blur();
                      }
                    }}
                    placeholder="Search title, hook, reason or transcript"
                    className="min-h-11 w-full rounded-lg border border-white/12 bg-panel-inset py-2 pl-9 pr-12 text-sm text-ink placeholder:text-muted/60 focus:border-ice focus:outline-none"
                  />
                  <kbd className="pointer-events-none absolute inset-y-0 right-3 my-auto hidden h-6 items-center rounded border border-white/15 px-1.5 font-mono text-[10px] text-muted md:flex">
                    /
                  </kbd>
                </label>

                <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Filter clips">
                    {(
                      [
                        ["all", `All · ${clips.length}`],
                        ["kept", `Kept · ${kept.length}`],
                        ["dropped", `Dropped · ${dropped}`],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={clipFilter === value}
                        onClick={() => setClipFilter(value)}
                        className={`cursor-pointer rounded-full border px-3 py-2 text-xs font-semibold transition ${
                          clipFilter === value
                            ? "border-volt bg-volt text-[#080b10]"
                            : "border-white/12 bg-panel-raised text-muted hover:border-white/25 hover:text-ink"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <span>Sort</span>
                      <select
                        value={clipSort}
                        onChange={(e) => setClipSort(e.target.value as Sort)}
                        className="min-h-9 cursor-pointer rounded-lg border border-white/12 bg-panel-inset px-2.5 text-xs font-semibold text-ink focus:border-ice focus:outline-none"
                      >
                        <option value="score">Highest score</option>
                        <option value="start">Timeline order</option>
                        <option value="duration">Longest first</option>
                      </select>
                    </label>
                    <div className="flex rounded-lg border border-white/12 bg-panel-inset p-1" role="group" aria-label="Clip layout">
                      {(["grid", "list"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={clipView === mode}
                          onClick={() => setClipView(mode)}
                          className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-bold capitalize transition ${
                            clipView === mode ? "bg-panel-raised text-volt" : "text-muted hover:text-ink"
                          }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
                  <p className="text-xs text-muted" aria-live="polite">
                    Showing <span className="font-bold text-ink">{visibleClips.length}</span> of {clips.length}
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
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy || busyClipIds.size > 0 || visibleClips.every((c) => c.kept)}
                      onClick={() => void bulkSetKept(true)}
                      className="cursor-pointer rounded-lg border border-volt/40 bg-volt/10 px-3 py-1.5 text-xs font-bold text-volt transition hover:bg-volt hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {bulkLabel && busy ? `Working ${bulkLabel}` : "Keep shown"}
                    </button>
                    <button
                      type="button"
                      disabled={busy || busyClipIds.size > 0 || visibleClips.every((c) => !c.kept)}
                      onClick={() => void bulkSetKept(false)}
                      className="cursor-pointer rounded-lg border border-white/15 bg-panel-raised px-3 py-1.5 text-xs font-bold text-muted transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Drop shown
                    </button>
                  </div>
                </div>
              </div>

              {visibleClips.length > 0 ? (
                <div className={clipView === "grid" ? "grid gap-5 md:grid-cols-2 2xl:grid-cols-3" : "flex flex-col gap-4"}>
                  {visibleClips.map((clip) => (
                    <div key={clip.id} id={`clip-${clip.id}`} className="scroll-mt-40">
                      <ClipCard
                        jobId={jobId}
                        clip={clip}
                        busy={busy || busyClipIds.has(clip.id)}
                        captionsEnabled={job.captions}
                        onKeep={(keptNext) => void updateClip(clip.id, { kept: keptNext })}
                        onTimes={(start, end) => void updateClip(clip.id, { start, end })}
                        onRerender={(start, end, captionStyle, template, displayName, handle) =>
                          handleRerender(clip.id, start, end, captionStyle, template, displayName, handle)
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/15 bg-panel p-8 text-center">
                  <h3 className="display text-3xl text-ink">No matching clips</h3>
                  <p className="mt-2 text-sm text-muted">Nothing fits the current search and filter.</p>
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="mt-4 cursor-pointer rounded-lg border border-white/15 px-4 py-2 text-xs font-bold text-ink transition hover:border-ice/50"
                  >
                    Reset filters
                  </button>
                </div>
              )}
            </section>
          ) : null}

          {running && clips.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-panel p-10 text-center">
              <p className="display text-3xl text-ink">Clips land here</p>
              <p className="mt-2 text-sm text-muted">
                Transcription, scoring, reframing and captioning are running. This page updates on its own, so you can
                switch tabs.
              </p>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}