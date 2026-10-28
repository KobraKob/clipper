"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { deleteJob, fetchJob, fetchJobLogs, patchClip, rerenderClip } from "@/lib/api";
import { formatTimecode } from "@/lib/pipeline";
import type { JobView } from "@/lib/types";
import { ClipCard } from "./ClipCard";
import { PipelineStrip } from "./PipelineStrip";
import { WaveBars } from "./WaveBars";

export function JobStudio({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<string>("");
  const [showLogs, setShowLogs] = useState<boolean>(false);
  const [clipSearch, setClipSearch] = useState("");
  const [clipFilter, setClipFilter] = useState<"all" | "kept" | "dropped">("all");
  const [clipSort, setClipSort] = useState<"score" | "start" | "duration">("score");
  const [clipView, setClipView] = useState<"grid" | "list">("grid");

  const refresh = useCallback(async () => {
    try {
      const next = await fetchJob(jobId);
      setJob(next);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this job.");
    }
  }, [jobId]);

  useEffect(() => {
    let ignore = false;
    fetchJob(jobId)
      .then((next) => {
        if (!ignore) {
          setJob(next);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Could not load this job.");
        }
      });
    return () => {
      ignore = true;
    };
  }, [jobId]);

  const isRunning = job?.status === "running";

  useEffect(() => {
    if (!isRunning) return;

    // Poll less aggressively and stop background-tab traffic. Refresh immediately
    // when the tab becomes visible again so progress does not feel stale.
    const pollWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(pollWhenVisible, 2000);
    document.addEventListener("visibilitychange", pollWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", pollWhenVisible);
    };
  }, [isRunning, refresh]);

  useEffect(() => {
    let ignore = false;
    async function loadLogs() {
      try {
        const res = await fetchJobLogs(jobId);
        if (!ignore) {
          setLogs(res.logs || "");
          if (res.status === "error") {
            setShowLogs(true);
          }
        }
      } catch {
        // Logs endpoint unavailable or job deleted
      }
    }

    void loadLogs();
    if (!isRunning && !showLogs) {
      return () => {
        ignore = true;
      };
    }

    // Logs are less time-sensitive than stage progress. Fetch them at a lower
    // cadence and do not keep reading them while the document is hidden.
    const pollLogsWhenVisible = () => {
      if (document.visibilityState === "visible") void loadLogs();
    };
    const timer = window.setInterval(pollLogsWhenVisible, 4000);
    document.addEventListener("visibilitychange", pollLogsWhenVisible);

    return () => {
      ignore = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", pollLogsWhenVisible);
    };
  }, [jobId, isRunning, showLogs]);

  async function updateClip(clipId: string, patch: { kept?: boolean; start?: number; end?: number }) {
    setBusy(true);
    try {
      const next = await patchClip(jobId, clipId, patch);
      setJob(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update clip.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRerender(clipId: string, start: number, end: number) {
    setBusy(true);
    try {
      const next = await rerenderClip(jobId, clipId, start, end);
      setJob(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not re-render clip.");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteJob() {
    if (!window.confirm("Are you sure you want to delete this cut and all its exported clips?")) {
      return;
    }
    setBusy(true);
    try {
      await deleteJob(jobId);
      router.push("/library");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete cut.");
      setBusy(false);
    }
  }

  if (error && !job) {
    return (
      <div className="flex flex-col gap-4 max-w-2xl mx-auto py-12">
        <p role="alert" className="border border-punch/60 bg-punch/15 text-punch px-4 py-3 font-semibold rounded-lg">
          {error}
        </p>
        <Link href="/" className="inline-block bg-volt text-[#101016] px-4 py-2 font-bold rounded-lg self-start hover:bg-[#e4ff78] transition">
          ← Back to New Cut
        </Link>
      </div>
    );
  }

  if (!job) {
    return <p className="font-semibold text-lg text-muted py-12 text-center">Loading the cut…</p>;
  }

  const running = job.status === "running";
  const kept = job.clips.filter((clip) => clip.kept);
  const dropped = job.clips.length - kept.length;
  const visibleClips = [...job.clips]
    .filter((clip) => {
      if (clipFilter === "kept" && !clip.kept) return false;
      if (clipFilter === "dropped" && clip.kept) return false;
      const query = clipSearch.trim().toLowerCase();
      if (!query) return true;
      return [clip.title, clip.hook, clip.reason, clip.text, clip.id]
        .some((value) => String(value || "").toLowerCase().includes(query));
    })
    .sort((a, b) => {
      if (clipSort === "start") return a.start - b.start;
      if (clipSort === "duration") return (b.end - b.start) - (a.end - a.start);
      return b.score - a.score;
    });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-mono font-bold tracking-wider uppercase text-ice">
            {job.sourceKind === "url" ? "From URL" : "From local video"}
          </p>
          <h1 className="display text-5xl md:text-7xl text-ink mt-1">This cut</h1>
          <p className="mt-2 max-w-xl break-all font-mono text-xs md:text-sm bg-panel-raised border border-white/12 text-muted p-2.5 rounded-lg">
            {job.source}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/" className="border border-white/20 bg-panel px-4 py-2 font-semibold text-ink rounded-lg stamp-sm hover:bg-panel-raised transition">
            + New cut
          </Link>
          <Link href="/library" className="border border-volt bg-volt px-4 py-2 font-bold text-[#101016] rounded-lg stamp-sm hover:bg-[#e4ff78] transition">
            Open library
          </Link>
          <button
            type="button"
            onClick={handleDeleteJob}
            disabled={busy}
            className="border border-punch/40 bg-punch/10 px-4 py-2 font-semibold text-punch rounded-lg stamp-sm hover:bg-punch hover:text-white transition disabled:opacity-60 cursor-pointer"
          >
            Delete cut
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="border border-punch/60 bg-punch/15 px-4 py-3 font-semibold text-punch rounded-lg">
          {error}
        </p>
      ) : null}

      <PipelineStrip stageId={job.stageId} progress={job.progress} />
      <WaveBars live={running} />

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Provider", job.provider],
          ["Clips", String(job.clipCount)],
          ["Frame", job.vertical ? "9:16 vertical" : "source format"],
          ["Captions", job.captions ? "burned animated" : "off"],
        ].map(([label, value]) => (
          <div key={label} className="border border-white/12 bg-panel p-3.5 rounded-lg stamp-sm">
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</dt>
            <dd className="display text-2xl md:text-3xl text-volt mt-1">{value}</dd>
          </div>
        ))}
      </dl>

      {running ? (
        <div className="border border-white/15 bg-panel p-5 rounded-xl stamp-sm">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-ink text-base">Pipeline in progress ({(job.progress * 100).toFixed(0)}%)</p>
            <span className="font-mono text-xs font-bold uppercase bg-volt text-[#101016] px-2 py-0.5 rounded">{job.stageId}</span>
          </div>
          {job.progressMessage ? (
            <p className="mt-3 font-mono text-sm text-volt font-semibold bg-panel-inset p-3 rounded-lg border border-white/10">
              {job.progressMessage}
            </p>
          ) : null}
          <p className="mt-3 text-sm text-muted">
            Real-time pipeline: speech transcription, candidate windowing, LLM scoring, 9:16 vertical reframing, and animated subtitles.
          </p>
        </div>
      ) : null}

      {/* Live Pipeline Terminal & Console Logs */}
      <div className="border border-white/15 bg-panel rounded-xl overflow-hidden stamp-sm">
        <button
          type="button"
          onClick={() => setShowLogs((prev) => !prev)}
          className="w-full flex items-center justify-between p-4 bg-panel-raised hover:bg-panel border-b border-white/10 text-left transition cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${
                running
                  ? "bg-volt animate-ping"
                  : job.status === "error"
                  ? "bg-punch"
                  : "bg-ice"
              }`}
            />
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-ink">
              Live Pipeline Console & Logs
            </span>
          </div>
          <span className="font-mono text-xs text-muted hover:text-ink">
            {showLogs ? "Hide Console ▲" : "Show Console ▼"}
          </span>
        </button>

        {showLogs ? (
          <div className="p-4 bg-[#0a0a0e] text-xs font-mono flex flex-col gap-2">
            <div className="flex items-center justify-between border-b border-white/10 pb-2 text-[11px] text-muted">
              <span>Tail of workdir/{jobId}/clipper.log</span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(logs);
                }}
                className="hover:text-volt transition cursor-pointer font-bold"
              >
                Copy Logs
              </button>
            </div>
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-all text-gray-300 leading-relaxed font-mono select-text bg-[#0e0e14] p-3 rounded-lg border border-white/5">
              {logs || "Connecting to live process output..."}
            </pre>
          </div>
        ) : null}
      </div>

      {job.status === "error" ? (
        <div role="alert" className="border border-punch/60 bg-punch/10 p-6 flex flex-col gap-4 rounded-xl stamp-sm">
          <div className="flex items-center gap-3">
            <span className="bg-punch text-white text-xs font-bold uppercase px-2 py-1 rounded">Cut Failed</span>
            <h2 className="display text-3xl text-punch">Processing Error</h2>
          </div>
          <div className="bg-panel-inset border border-punch/40 p-4 font-mono text-sm text-ink rounded-lg break-words">
            <p className="font-bold text-punch mb-1">Error Details:</p>
            <p>{job.error || job.progressMessage || "An unexpected error occurred during processing."}</p>
          </div>
          <p className="text-xs text-muted">
            Check the console or job logs in <code className="bg-panel-raised px-1.5 py-0.5 rounded border border-white/10 text-ink">workdir/{jobId}/clipper.log</code> for full trace.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href="/"
              className="bg-volt px-4 py-2 font-bold text-[#101016] hover:bg-[#e4ff78] rounded-lg transition stamp-sm"
            >
              ← Start New Cut
            </Link>
            <button
              type="button"
              onClick={handleDeleteJob}
              disabled={busy}
              className="border border-white/20 bg-panel px-4 py-2 font-bold text-ink hover:bg-panel-raised rounded-lg transition stamp-sm cursor-pointer"
            >
              Delete This Cut
            </button>
          </div>
        </div>
      ) : null}

      {job.status === "done" && job.clips.length === 0 ? (
        <div className="border border-white/15 bg-panel p-8 rounded-xl stamp-sm text-center">
          <p className="display text-3xl text-volt">No clips generated</p>
          <p className="mt-2 text-muted">
            The video was processed, but no candidate segments met the score/duration threshold.
          </p>
        </div>
      ) : null}

      {job.status === "done" && job.clips.length > 0 ? (
        <section className="flex flex-col gap-4" aria-labelledby="clip-review-title">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.16em] text-ice">REVIEW WORKSPACE</p>
              <h2 id="clip-review-title" className="display mt-2 text-4xl text-ink md:text-5xl">Your clips<span className="text-volt">.</span></h2>
              <p className="mt-2 text-sm text-muted">Search, sort and keep the strongest moments. Changes save to this project.</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-lg border border-volt/25 bg-volt/10 px-3 py-2 font-bold text-volt">{kept.length} kept</span>
              <span className="rounded-lg border border-white/12 bg-panel px-3 py-2 font-bold text-muted">{dropped} dropped</span>
              <span className="rounded-lg border border-white/12 bg-panel px-3 py-2 font-mono font-bold text-ink">{Math.round(kept.reduce((sum, clip) => sum + (clip.end - clip.start), 0))}s runtime</span>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-panel p-3 md:p-4">
            <label className="relative block">
              <span className="sr-only">Search clips</span>
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted" aria-hidden="true">⌕</span>
              <input
                type="search"
                value={clipSearch}
                onChange={(event) => setClipSearch(event.target.value)}
                placeholder="Search by title, hook, reason, or transcript…"
                className="min-h-11 w-full rounded-lg border border-white/12 bg-panel-inset py-2 pl-9 pr-3 text-sm text-ink placeholder:text-muted/60 focus:border-ice focus:outline-none"
              />
            </label>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter clips">
                {([
                  ["all", `All clips · ${job.clips.length}`],
                  ["kept", `Kept · ${kept.length}`],
                  ["dropped", `Dropped · ${dropped}`],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={clipFilter === value}
                    onClick={() => setClipFilter(value)}
                    className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${clipFilter === value ? "border-volt bg-volt text-[#080b10]" : "border-white/12 bg-panel-raised text-muted hover:border-white/25 hover:text-ink"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 xl:justify-end">
                <label className="flex items-center gap-2 text-xs text-muted">
                  <span>Sort by</span>
                  <select
                    value={clipSort}
                    onChange={(event) => setClipSort(event.target.value as "score" | "start" | "duration")}
                    className="min-h-9 rounded-lg border border-white/12 bg-panel-inset px-2.5 text-xs font-semibold text-ink"
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
                      className={`rounded-md px-3 py-1.5 text-xs font-bold capitalize transition ${clipView === mode ? "bg-panel-raised text-volt" : "text-muted hover:text-ink"}`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {visibleClips.length > 0 ? (
            <div className={clipView === "grid" ? "grid gap-5 md:grid-cols-2 2xl:grid-cols-3" : "flex flex-col gap-4"}>
              {visibleClips.map((clip) => (
                <ClipCard
                  key={clip.id}
                  jobId={jobId}
                  clip={clip}
                  busy={busy}
                  onKeep={(keptNext) => void updateClip(clip.id, { kept: keptNext })}
                  onTimes={(start, end) => void updateClip(clip.id, { start, end })}
                  onRerender={(start, end) => handleRerender(clip.id, start, end)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/15 bg-panel p-8 text-center">
              <h3 className="display text-3xl text-ink">No matching clips</h3>
              <p className="mt-2 text-sm text-muted">Try another search or switch the keep/drop filter.</p>
              <button type="button" onClick={() => { setClipSearch(""); setClipFilter("all"); }} className="mt-4 rounded-lg border border-white/15 px-4 py-2 text-xs font-bold text-ink hover:border-ice/50">Reset clip filters</button>
            </div>
          )}
        </section>
      ) : null}

      {job.status === "done" && job.clips.length > 0 ? (
        <p className="text-sm text-muted">
          Clips ready for publishing. Word-level timestamps start at:{" "}
          {job.clips.map((c) => formatTimecode(c.start)).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
