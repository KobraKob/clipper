"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { deleteJob, fetchJob, patchClip, rerenderClip } from "@/lib/api";
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
    const timer = window.setInterval(() => {
      void refresh();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRunning, refresh]);

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
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="display text-4xl md:text-5xl text-ink">Ranked clips</h2>
            <p className="font-semibold text-muted">
              {kept.length} kept · {kept.reduce((sum, clip) => sum + (clip.end - clip.start), 0) | 0}s total runtime
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {job.clips.map((clip) => (
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
