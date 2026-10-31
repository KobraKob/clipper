"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchJobs, scheduleClip } from "@/lib/api";
import type { JobView, Platform } from "@/lib/types";

function defaultScheduleTime() {
  const value = new Date(Date.now() + 24 * 60 * 60 * 1000);
  value.setHours(18, 0, 0, 0);
  const offset = value.getTimezoneOffset();
  return new Date(value.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function CalendarScheduler() {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [loading, setLoading] = useState(false);
  const [jobClip, setJobClip] = useState("");
  const [platform, setPlatform] = useState<Platform | "both">("youtube");
  const [scheduledAt, setScheduledAt] = useState(defaultScheduleTime);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!open || jobs.length) return;
    let active = true;
    setLoading(true);
    fetchJobs()
      .then((items) => {
        if (active) {
          setJobs(items);
          const first = items.find((job) => job.status === "done" && job.clips.some((clip) => clip.kept && clip.file));
          const clip = first?.clips.find((item) => item.kept && item.file);
          if (first && clip) setJobClip(`${first.id}::${clip.id}`);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load your library.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [open, jobs.length]);

  const options = useMemo(() => jobs.flatMap((job) => {
    if (job.status !== "done") return [];
    return job.clips
      .filter((clip) => clip.kept && Boolean(clip.file))
      .map((clip) => ({
        value: `${job.id}::${clip.id}`,
        label: `${clip.seo?.youtube?.title || clip.title} · ${job.id.slice(0, 8)}`,
        jobId: job.id,
        clipId: clip.id,
        hasYoutubeCopy: Boolean(clip.seo?.youtube?.title),
        hasInstagramCopy: Boolean(clip.seo?.instagram?.caption),
      }));
  }), [jobs]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    const selected = options.find((option) => option.value === jobClip);
    if (!selected) {
      setError("Choose a finished, kept clip from your library.");
      return;
    }
    if (platform !== "instagram" && !selected.hasYoutubeCopy) {
      setError("This clip needs a YouTube title. Open the clip in Library and save its publishing details first.");
      return;
    }
    if (platform !== "youtube" && !selected.hasInstagramCopy) {
      setError("This clip needs an Instagram caption. Open the clip in Library and save its publishing details first.");
      return;
    }
    const date = new Date(scheduledAt);
    if (!scheduledAt || !Number.isFinite(date.getTime()) || date.getTime() < Date.now() + 2 * 60_000) {
      setError("Choose a time at least two minutes in the future.");
      return;
    }

    setBusy(true);
    setStage("Preparing the finished clip…");
    try {
      setStage("Uploading the MP4 to private cloud storage. Keep this tab open…");
      await scheduleClip(selected.jobId, selected.clipId, platform, date.toISOString());
      setStage("Saving the calendar entry…");
      setSuccess("Video uploaded and added to your publishing queue.");
      setStage("");
      setOpen(false);
      window.location.reload();
    } catch (reason) {
      setStage("");
      setError(reason instanceof Error ? reason.message : "Scheduling failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-white/12 bg-panel p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.16em] text-ice">NEW QUEUED VIDEO</p>
          <h2 className="display mt-1 text-2xl text-ink">Schedule a video</h2>
          <p className="mt-1 text-xs text-muted">Choose a finished clip from your library. Chop Shop uploads its MP4 to cloud storage before adding it to the calendar.</p>
        </div>
        <button type="button" onClick={() => { setOpen((value) => !value); setError(""); }} disabled={busy}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-volt px-4 py-2 text-xs font-extrabold text-[#080b10] transition hover:bg-[#e4ff83] disabled:opacity-50">
          {open ? "Close scheduler" : "+ Schedule a video"}
        </button>
      </div>

      {success ? <p role="status" className="mt-3 rounded-lg border border-volt/30 bg-volt/10 p-3 text-sm text-volt">{success}</p> : null}
      {open ? (
        <form onSubmit={submit} className="mt-4 grid gap-3 border-t border-white/10 pt-4 md:grid-cols-2">
          <label className="grid gap-1 text-xs font-bold uppercase tracking-wide text-muted md:col-span-2">
            Finished library clip
            <select value={jobClip} onChange={(event) => setJobClip(event.target.value)} disabled={loading || busy || !options.length}
              className="min-h-11 rounded-lg border border-white/15 bg-panel-inset px-3 text-sm font-medium normal-case tracking-normal text-ink">
              <option value="">{loading ? "Loading library…" : options.length ? "Select a kept clip…" : "No finished, kept clips found"}</option>
              {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-bold uppercase tracking-wide text-muted">
            Platform
            <select value={platform} onChange={(event) => setPlatform(event.target.value as Platform | "both")} disabled={busy}
              className="min-h-11 rounded-lg border border-white/15 bg-panel-inset px-3 text-sm font-medium normal-case tracking-normal text-ink">
              <option value="youtube">YouTube Shorts</option>
              <option value="instagram">Instagram Reels</option>
              <option value="both">Both platforms</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-bold uppercase tracking-wide text-muted">
            Publish date and time (local)
            <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} disabled={busy}
              className="min-h-11 rounded-lg border border-white/15 bg-panel-inset px-3 text-sm font-medium normal-case tracking-normal text-ink" />
          </label>

          {busy ? (
            <div className="flex items-center gap-3 rounded-lg border border-ice/25 bg-ice/10 p-3 text-sm text-ice md:col-span-2" role="status" aria-live="polite">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-ice/30 border-t-ice" />
              <span>{stage || "Scheduling…"}</span>
            </div>
          ) : null}
          {error ? <p role="alert" className="rounded-lg border border-punch/40 bg-punch/10 p-3 text-sm text-punch md:col-span-2">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
            <button type="submit" disabled={busy || loading || !options.length}
              className="min-h-11 rounded-lg bg-volt px-5 py-2 text-xs font-extrabold text-[#080b10] disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? "Uploading and scheduling…" : "Upload video & schedule"}
            </button>
            <span className="text-xs text-muted">The MP4 upload completes before the queue entry is created.</span>
          </div>
        </form>
      ) : null}
    </section>
  );
}
