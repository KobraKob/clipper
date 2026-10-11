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
      <div className="flex flex-col gap-4">
        <p role="alert" className="border-4 border-punch bg-punch px-4 py-3 font-semibold text-white">
          {error}
        </p>
        <Link href="/" className="inline-block border-4 border-court bg-volt px-4 py-2 font-semibold self-start">
          ← Back to New Cut
        </Link>
      </div>
    );
  }

  if (!job) {
    return <p className="font-semibold text-lg">Loading the cut…</p>;
  }

  const running = job.status === "running";
  const kept = job.clips.filter((clip) => clip.kept);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-semibold text-court">{job.sourceKind === "url" ? "From URL" : "From local video"}</p>
          <h1 className="display text-6xl text-court md:text-7xl">This cut</h1>
          <p className="mt-2 max-w-xl break-all font-mono text-sm bg-white/70 p-2 border-2 border-court/30">
            {job.source}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/" className="border-4 border-court bg-white px-4 py-2 font-semibold stamp-sm hover:bg-paper">
            + New cut
          </Link>
          <Link href="/library" className="border-4 border-court bg-volt px-4 py-2 font-semibold stamp-sm hover:bg-volt/80">
            Open library
          </Link>
          <button
            type="button"
            onClick={handleDeleteJob}
            disabled={busy}
            className="border-4 border-court bg-punch px-4 py-2 font-semibold text-white stamp-sm hover:bg-punch/90 transition disabled:opacity-60"
          >
            Delete cut
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="border-4 border-punch bg-punch px-4 py-3 font-semibold text-white">
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
          <div key={label} className="border-4 border-court bg-white p-3">
            <dt className="text-sm font-semibold text-court">{label}</dt>
            <dd className="display text-3xl">{value}</dd>
          </div>
        ))}
      </dl>

      {running ? (
        <div className="border-4 border-court bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-court">Pipeline in progress ({(job.progress * 100).toFixed(0)}%)</p>
            <span className="font-mono text-xs font-bold uppercase bg-volt px-2 py-1">{job.stageId}</span>
          </div>
          {job.progressMessage ? (
            <p className="mt-2 font-mono text-sm text-court font-semibold bg-paper/60 p-2 border-2 border-court/30">
              {job.progressMessage}
            </p>
          ) : null}
          <p className="mt-2 text-sm text-ink/80">
            Real-time pipeline: speech transcription, candidate windowing, LLM scoring, 9:16 vertical reframing, and animated subtitles.
          </p>
        </div>
      ) : null}

      {job.status === "done" && job.clips.length === 0 ? (
        <div className="border-4 border-court bg-white p-6">
          <p className="display text-3xl text-court">No clips generated</p>
          <p className="mt-2 text-ink/80">
            The video was processed, but no candidate segments met the score/duration threshold.
          </p>
        </div>
      ) : null}

      {job.status === "done" && job.clips.length > 0 ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="display text-5xl text-court">Ranked clips</h2>
            <p className="font-semibold text-court">
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
        <p className="text-sm text-ink/70">
          Clips ready for publishing. Word-level timestamps start at:{" "}
          {job.clips.map((c) => formatTimecode(c.start)).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
