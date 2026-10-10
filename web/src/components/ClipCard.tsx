"use client";

import { useEffect, useState } from "react";
import { formatTimecode } from "@/lib/pipeline";
import type { Clip } from "@/lib/types";

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
