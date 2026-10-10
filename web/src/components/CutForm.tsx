"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createJob, providerNote } from "@/lib/api";
import type { Provider } from "@/lib/types";

export function CutForm() {
  const router = useRouter();
  const [sourceUrl, setSourceUrl] = useState("");
  const [clipCount, setClipCount] = useState(5);
  const [provider, setProvider] = useState<Provider>("local");
  const [vertical, setVertical] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    const trimmedSource = sourceUrl.trim();
    if (!trimmedSource) {
      setError("Please provide a video URL or local file path.");
      return;
    }

    setBusy(true);
    try {
      const job = await createJob({
        sourceUrl: trimmedSource,
        clipCount,
        provider,
        vertical,
        captions,
      });
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a cut.");
      setBusy(false);
    }
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setSourceUrl(file.name);
    }
  }

  return (
    <form onSubmit={onSubmit} className="border-4 border-court bg-white stamp">
      <div className="border-b-4 border-court bg-court px-4 py-3 text-volt flex items-center justify-between">
        <p className="display text-3xl">New cut</p>
        <span className="text-xs font-mono font-bold bg-volt text-ink px-2 py-1">Ready</span>
      </div>
      <div className="flex flex-col gap-5 p-4 md:p-6">
        <label className="flex flex-col gap-2">
          <span className="font-semibold text-court">Video Source (URL or Local File Path)</span>
          <input
            type="text"
            name="sourceUrl"
            placeholder="https://youtube.com/... or C:\path\to\video.mp4"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            className="border-4 border-court bg-paper px-3 py-3 text-base md:text-lg font-mono"
          />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-2 border-2 border-court/30 bg-paper/50 p-3">
          <div className="flex items-center gap-2">
            <label className="cursor-pointer border-2 border-court bg-white px-3 py-1 text-sm font-semibold hover:bg-volt transition">
              Browse File…
              <input
                type="file"
                accept="video/*"
                className="sr-only"
                onChange={handleFileSelected}
              />
            </label>
            <span className="text-xs text-ink/70">mp4, mov, mkv, webm</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-court">Quick examples:</span>
            <button
              type="button"
              onClick={() => setSourceUrl("tests_workdir/synthetic_fixture.mp4")}
              className="text-xs underline font-medium hover:text-punch"
            >
              Synthetic fixture
            </button>
            <button
              type="button"
              onClick={() => setSourceUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")}
              className="text-xs underline font-medium hover:text-punch"
            >
              YouTube URL
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="font-semibold text-court">Target Clips Count</span>
            <input
              type="number"
              min={1}
              max={8}
              value={clipCount}
              onChange={(e) => setClipCount(Math.max(1, Math.min(8, Number(e.target.value))))}
              className="border-4 border-court bg-paper px-3 py-3 text-lg font-bold"
            />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="font-semibold text-court">Inference Provider</legend>
            <div className="grid grid-cols-2 border-4 border-court">
              {(["local", "groq"] as const).map((option) => (
                <label
                  key={option}
                  className={`cursor-pointer px-3 py-3 text-center font-semibold transition ${
                    provider === option ? "bg-volt text-ink" : "bg-white text-ink/80 hover:bg-paper"
                  }`}
                >
                  <input
                    type="radio"
                    name="provider"
                    value={option}
                    checked={provider === option}
                    onChange={() => setProvider(option)}
                    className="sr-only"
                  />
                  {option.toUpperCase()}
                </label>
              ))}
            </div>
            <p className="text-xs text-ink/70">{providerNote(provider)}</p>
          </fieldset>
        </div>

        <div className="flex flex-wrap gap-6 pt-2">
          <label className="flex items-center gap-2 font-semibold text-court cursor-pointer">
            <input
              type="checkbox"
              checked={vertical}
              onChange={(e) => setVertical(e.target.checked)}
              className="h-5 w-5 accent-punch cursor-pointer"
            />
            Vertical 9:16 (YuNet Face-Tracking)
          </label>
          <label className="flex items-center gap-2 font-semibold text-court cursor-pointer">
            <input
              type="checkbox"
              checked={captions}
              onChange={(e) => setCaptions(e.target.checked)}
              className="h-5 w-5 accent-punch cursor-pointer"
            />
            Burned Animated Subtitles (\k Karaoke)
          </label>
        </div>

        {error ? (
          <p role="alert" className="border-4 border-punch bg-punch px-3 py-2 font-semibold text-white">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="display bg-punch px-4 py-4 text-3xl md:text-4xl text-white stamp-sm hover:bg-punch/90 transition disabled:opacity-60 disabled:cursor-wait"
        >
          {busy ? "Starting cut…" : "Cut clips"}
        </button>
      </div>
    </form>
  );
}
