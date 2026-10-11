"use client";

import { useEffect, useState } from "react";
import { formatTimecode } from "@/lib/pipeline";
import { publishClip } from "@/lib/api";
import type { Clip, Platform } from "@/lib/types";

export function ClipCard({
  jobId,
  clip,
  busy,
  onKeep,
  onTimes,
}: {
  jobId: string;
  clip: Clip;
  busy?: boolean;
  onKeep: (kept: boolean) => void;
  onTimes: (start: number, end: number) => void;
}) {
  const [start, setStart] = useState(clip.start);
  const [end, setEnd] = useState(clip.end);
  const [timeError, setTimeError] = useState("");
  const [hasVideo, setHasVideo] = useState(Boolean(clip.file));
  const [publishing, setPublishing] = useState<Platform | "both" | null>(null);
  const [publishState, setPublishState] = useState(clip.publish || {});
  const [publishError, setPublishError] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    setStart(clip.start);
    setEnd(clip.end);
    setTimeError("");
    if (clip.file) setHasVideo(true);
  }, [clip.start, clip.end, clip.file]);

  function handleBlur() {
    if (isNaN(start) || isNaN(end) || start < 0) {
      setTimeError("Timestamps must be non-negative numbers.");
      return;
    }
    if (end <= start) {
      setTimeError("End time must be greater than start time.");
      return;
    }
    setTimeError("");
    onTimes(start, end);
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      // clipboard unavailable
    }
  }

  async function doPublish(target: Platform | "both") {
    setPublishError("");
    setPublishing(target);
    try {
      const job = await publishClip(jobId, clip.id, target === "both" ? ["youtube", "instagram"] : [target]);
      const updated = job.clips.find((c) => c.id === clip.id);
      setPublishState(updated?.publish || {});
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Publish failed.");
    } finally {
      setPublishing(null);
    }
  }

  const videoSrc = `/api/jobs/${jobId}/clips/${clip.id}`;

  return (
    <article className={`border-4 border-court bg-white stamp-sm ${clip.kept ? "" : "opacity-60"}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b-4 border-court">
        <div className="bg-court px-3 py-3 text-volt">
          <h3 className="display text-3xl">{clip.title}</h3>
        </div>
        <p className="flex items-center bg-volt px-4 text-3xl font-extrabold text-ink">
          {clip.score}
        </p>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          {hasVideo ? (
            <div className="aspect-[9/16] max-h-80 w-44 shrink-0 overflow-hidden border-4 border-ink bg-ink">
              <video
                controls
                playsInline
                preload="metadata"
                src={videoSrc}
                className="h-full w-full object-cover"
                onError={() => setHasVideo(false)}
              />
            </div>
          ) : (
            <div className="aspect-[9/16] max-h-72 w-40 shrink-0 self-start border-4 border-ink bg-court p-3 text-volt flex flex-col justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-white">9:16 Preview</p>
                <p className="display mt-4 text-2xl leading-tight">
                  {clip.hook.split(" ").slice(0, 8).join(" ")}
                </p>
              </div>
              <p className="text-[10px] font-semibold text-white/80">
                {formatTimecode(clip.start)} – {formatTimecode(clip.end)}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <p className="font-semibold text-court">{clip.reason}</p>
            <p className="text-sm text-ink/80">{clip.text}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Start Time
            <input
              type="number"
              min={0}
              step={0.1}
              value={start}
              className="border-4 border-court px-2 py-2"
              onChange={(e) => setStart(Number(e.target.value))}
              onBlur={handleBlur}
            />
            <span className="font-normal text-xs text-ink/70">{formatTimecode(start)}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            End Time
            <input
              type="number"
              min={0}
              step={0.1}
              value={end}
              className="border-4 border-court px-2 py-2"
              onChange={(e) => setEnd(Number(e.target.value))}
              onBlur={handleBlur}
            />
            <span className="font-normal text-xs text-ink/70">{formatTimecode(end)}</span>
          </label>
        </div>

        {timeError ? (
          <p role="alert" className="text-xs font-bold text-punch">
            {timeError}
          </p>
        ) : null}

        {clip.seo ? (
          <div className="flex flex-col gap-2 border-2 border-court/30 bg-paper/50 p-3 text-sm">
            <p className="font-bold text-court">Title, description &amp; hashtags</p>
            <p className="font-semibold">{clip.seo.youtube.title}</p>
            <p className="whitespace-pre-line text-ink/80">{clip.seo.youtube.description}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="border-2 border-court bg-white px-2 py-1 text-xs font-semibold" onClick={() => copy("yt", `${clip.seo!.youtube.title}\n\n${clip.seo!.youtube.description}`)}>
                {copied === "yt" ? "Copied" : "Copy YouTube text"}
              </button>
              <button type="button" className="border-2 border-court bg-white px-2 py-1 text-xs font-semibold" onClick={() => copy("ig", clip.seo!.instagram.caption)}>
                {copied === "ig" ? "Copied" : "Copy Instagram caption"}
              </button>
            </div>
          </div>
        ) : null}

        {hasVideo && clip.seo ? (
          <div className="flex flex-col gap-2">
            <p className="font-bold text-court">Publish</p>
            <div className="flex flex-wrap gap-2">
              {(["youtube", "instagram", "both"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={publishing !== null}
                  onClick={() => doPublish(t)}
                  className="border-4 border-court bg-white px-3 py-2 font-semibold hover:bg-volt transition disabled:opacity-60 disabled:cursor-wait"
                >
                  {publishing === t ? "Uploading…" : t === "youtube" ? "YouTube Shorts" : t === "instagram" ? "Instagram Reels" : "Both"}
                </button>
              ))}
            </div>
            {(["youtube", "instagram"] as const).map((p) => {
              const r = publishState[p];
              if (!r) return null;
              return r.status === "published" ? (
                <p key={p} className="text-xs font-semibold text-court">
                  {p === "youtube" ? "YouTube" : "Instagram"}: published{" "}
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer" className="underline">
                      open
                    </a>
                  ) : null}
                </p>
              ) : (
                <p key={p} role="alert" className="text-xs font-bold text-punch">
                  {p === "youtube" ? "YouTube" : "Instagram"}: {r.error}
                </p>
              );
            })}
            {publishError ? <p role="alert" className="text-xs font-bold text-punch">{publishError}</p> : null}
            <p className="text-xs text-ink/60">YouTube uploads default to private (set YOUTUBE_PRIVACY in .env).</p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t-2 border-court/20">
          <button
            type="button"
            disabled={busy}
            onClick={() => onKeep(!clip.kept)}
            className="border-4 border-court bg-volt px-3 py-2 font-semibold hover:bg-volt/80 transition"
          >
            {clip.kept ? "Drop this clip" : "Keep this clip"}
          </button>

          {hasVideo ? (
            <a
              href={videoSrc}
              download={`${clip.title.replace(/\s+/g, "_").toLowerCase()}.mp4`}
              className="border-4 border-court bg-punch text-white px-3 py-2 font-semibold hover:bg-punch/90 transition inline-block text-center"
            >
              Download MP4
            </a>
          ) : null}

          <button
            type="button"
            className="border-4 border-court bg-white px-3 py-2 font-semibold hover:bg-paper transition"
            onClick={() => {
              const blob = new Blob([JSON.stringify(clip, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${clip.title.replace(/\s+/g, "-").toLowerCase()}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Metadata JSON
          </button>
        </div>
      </div>
    </article>
  );
}
