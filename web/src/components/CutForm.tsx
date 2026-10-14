"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createJob, providerNote, uploadVideo } from "@/lib/api";
import { CAPTION_STYLE_OPTIONS } from "@/lib/captionStyles";
import type { Layout, Provider, VideoEncoder } from "@/lib/types";

export function CutForm() {
  const router = useRouter();
  const [sourceUrl, setSourceUrl] = useState("");
  const [clipCount, setClipCount] = useState(5);
  const [provider, setProvider] = useState<Provider>("local");
  const [vertical, setVertical] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [captionStyle, setCaptionStyle] = useState("bold_pop");
  const [layout, setLayout] = useState<Layout>("fill");
  const [videoEncoder, setVideoEncoder] = useState<VideoEncoder>("auto");
  const [hookOverlay, setHookOverlay] = useState(true);
  const [loudnorm, setLoudnorm] = useState(true);
  const [trimSilence, setTrimSilence] = useState(false);
  const [progressBar, setProgressBar] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");

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
        captionStyle,
        layout,
        videoEncoder,
        trimSilence,
        hookOverlay,
        progressBar,
        loudnorm,
      });
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a cut.");
      setBusy(false);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError("");
    setUploading(true);
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    setUploadProgress(`Uploading ${file.name} (${sizeMb} MB)…`);

    try {
      const result = await uploadVideo(file);
      setSourceUrl(result.path);
      setUploadProgress(`Uploaded: ${file.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload file.");
      setUploadProgress("");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="border border-white/15 bg-panel rounded-xl overflow-hidden stamp-sm">
      <div className="border-b border-white/12 bg-panel-raised px-4 py-3 flex items-center justify-between text-volt">
        <p className="display text-2xl md:text-3xl">New cut</p>
        <span className="text-xs font-mono font-bold bg-volt text-[#101016] px-2 py-0.5 rounded">Ready</span>
      </div>
      <div className="flex flex-col gap-5 p-4 md:p-6">
        <label className="flex flex-col gap-2">
          <span className="font-semibold text-ink">Video Source (URL or Local File Path)</span>
          <input
            type="text"
            name="sourceUrl"
            placeholder="https://youtube.com/... or C:\path\to\video.mp4"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            className="w-full border border-white/20 bg-panel-inset px-3.5 py-3 text-base md:text-lg font-mono text-ink rounded-lg placeholder:text-muted/50 focus:border-ice focus:outline-none transition"
          />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-2 border border-white/10 bg-panel-inset/60 p-3 rounded-lg">
          <div className="flex items-center gap-2">
            <label className="cursor-pointer border border-white/20 bg-panel-raised px-3.5 py-1.5 text-sm font-semibold text-ink rounded hover:bg-volt hover:text-[#101016] hover:border-volt transition disabled:opacity-60">
              {uploading ? uploadProgress || "Uploading…" : "Browse File…"}
              <input
                type="file"
                accept="video/*"
                disabled={uploading || busy}
                className="sr-only"
                onChange={handleFileSelected}
              />
            </label>
            <span className="text-xs text-muted">mp4, mov, mkv, webm</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted">Quick examples:</span>
            <button
              type="button"
              onClick={() => setSourceUrl("tests_workdir/synthetic_fixture.mp4")}
              className="text-xs underline font-medium text-muted hover:text-volt transition"
            >
              Synthetic fixture
            </button>
            <button
              type="button"
              onClick={() => setSourceUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")}
              className="text-xs underline font-medium text-muted hover:text-volt transition"
            >
              YouTube URL
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="font-semibold text-ink">Target Clips Count</span>
            <input
              type="number"
              min={1}
              max={8}
              value={clipCount}
              onChange={(e) => setClipCount(Math.max(1, Math.min(8, Number(e.target.value))))}
              className="w-full border border-white/20 bg-panel-inset px-3 py-3 text-lg font-bold text-ink rounded-lg focus:border-ice focus:outline-none transition"
            />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="font-semibold text-ink">Inference Provider</legend>
            <div className="grid grid-cols-3 border border-white/15 rounded-lg overflow-hidden bg-panel-inset">
              {(["local", "groq", "openrouter"] as const).map((option) => (
                <label
                  key={option}
                  className={`cursor-pointer px-3 py-3 text-center font-semibold transition ${
                    provider === option ? "bg-volt text-[#101016] font-bold" : "bg-panel-raised text-muted hover:text-ink hover:bg-panel"
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
            <p className="text-xs text-muted">{providerNote(provider)}</p>
          </fieldset>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold text-ink">Hardware Acceleration (Encoder)</legend>
          <div className="grid grid-cols-2 md:grid-cols-4 border border-white/15 rounded-lg overflow-hidden bg-panel-inset">
            {(
              [
                ["auto", "Auto", "NVENC GPU preferred with CPU fallback"],
                ["h264_nvenc", "NVIDIA NVENC", "Hardware GPU render (RTX/GTX)"],
                ["libx264", "CPU (libx264)", "Standard software encoder"],
                ["h264_qsv", "Intel QSV", "Intel QuickSync GPU"],
              ] as const
            ).map(([value, label, note]) => (
              <label
                key={value}
                className={`cursor-pointer px-3 py-2 text-center transition ${
                  videoEncoder === value ? "bg-volt text-[#101016] font-bold" : "bg-panel-raised text-muted hover:text-ink hover:bg-panel"
                }`}
              >
                <input
                  type="radio"
                  name="videoEncoder"
                  value={value}
                  checked={videoEncoder === value}
                  onChange={() => setVideoEncoder(value)}
                  className="sr-only"
                />
                <span className="block text-sm font-semibold">{label}</span>
                <span className="block text-xs opacity-75">{note}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-6 pt-2">
          <label className="flex items-center gap-2.5 font-semibold text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={vertical}
              onChange={(e) => setVertical(e.target.checked)}
              className="h-5 w-5 accent-volt cursor-pointer rounded"
            />
            Vertical 9:16 (full screen, face-tracked)
          </label>
          <label className="flex items-center gap-2.5 font-semibold text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={captions}
              onChange={(e) => setCaptions(e.target.checked)}
              className="h-5 w-5 accent-volt cursor-pointer rounded"
            />
            Animated captions
          </label>
        </div>

        {vertical ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="font-semibold text-ink">Framing</legend>
            <div className="grid grid-cols-1 md:grid-cols-3 border border-white/15 rounded-lg overflow-hidden bg-panel-inset">
              {(
                [
                  ["fill", "Fill screen", "Crops to 9:16 and follows the active speaker"],
                  ["fit_blur", "Fit + blur", "Whole frame on blurred backdrop (slides, gameplay)"],
                  ["split_screen", "Split screen", "Two-speaker split view with dual face framing"],
                ] as const
              ).map(([value, label, note]) => (
                <label
                  key={value}
                  className={`cursor-pointer px-3 py-2 text-center transition ${
                    layout === value ? "bg-volt text-[#101016] font-bold" : "bg-panel-raised text-muted hover:text-ink hover:bg-panel"
                  }`}
                >
                  <input
                    type="radio"
                    name="layout"
                    value={value}
                    checked={layout === value}
                    onChange={() => setLayout(value)}
                    className="sr-only"
                  />
                  <span className="block font-semibold">{label}</span>
                  <span className="block text-xs opacity-75">{note}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold text-ink flex items-center gap-2">
            Retention &amp; Audio Optimization
            <span className="text-xs font-mono font-bold bg-volt text-[#101016] px-1.5 py-0.5 rounded">Viral Shorts Kit</span>
          </legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border border-white/12 p-3 bg-panel-inset/50 rounded-lg">
            <label className="flex items-start gap-2.5 cursor-pointer p-3 bg-panel-raised/80 border border-white/10 hover:border-white/25 rounded-lg transition">
              <input
                type="checkbox"
                checked={hookOverlay}
                onChange={(e) => setHookOverlay(e.target.checked)}
                className="mt-1 h-5 w-5 accent-volt cursor-pointer rounded"
              />
              <div className="flex flex-col">
                <span className="font-semibold text-sm text-ink">Hook Headline Overlay (0–2.5s)</span>
                <span className="text-xs text-muted leading-relaxed">Big punchy headline with smooth fade-out to maximize initial retention.</span>
              </div>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer p-3 bg-panel-raised/80 border border-white/10 hover:border-white/25 rounded-lg transition">
              <input
                type="checkbox"
                checked={loudnorm}
                onChange={(e) => setLoudnorm(e.target.checked)}
                className="mt-1 h-5 w-5 accent-volt cursor-pointer rounded"
              />
              <div className="flex flex-col">
                <span className="font-semibold text-sm text-ink">Loudness Normalization (-14 LUFS)</span>
                <span className="text-xs text-muted leading-relaxed">Normalizes audio to YouTube &amp; Instagram broadcast standards so clips never sound quiet.</span>
              </div>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer p-3 bg-panel-raised/80 border border-white/10 hover:border-white/25 rounded-lg transition">
              <input
                type="checkbox"
                checked={trimSilence}
                onChange={(e) => setTrimSilence(e.target.checked)}
                className="mt-1 h-5 w-5 accent-volt cursor-pointer rounded"
              />
              <div className="flex flex-col">
                <span className="font-semibold text-sm text-ink">Silence &amp; Filler Trimming</span>
                <span className="text-xs text-muted leading-relaxed">Cuts dead pauses &gt;0.4s and removes filler words (um/uh), keeping caption timing in sync.</span>
              </div>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer p-3 bg-panel-raised/80 border border-white/10 hover:border-white/25 rounded-lg transition">
              <input
                type="checkbox"
                checked={progressBar}
                onChange={(e) => setProgressBar(e.target.checked)}
                className="mt-1 h-5 w-5 accent-volt cursor-pointer rounded"
              />
              <div className="flex flex-col">
                <span className="font-semibold text-sm text-ink">Bottom Progress Bar</span>
                <span className="text-xs text-muted leading-relaxed">Sleek neon progress bar at the bottom edge to encourage full watch time.</span>
              </div>
            </label>
          </div>
        </fieldset>

        {captions ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="font-semibold text-ink">Caption style</legend>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {CAPTION_STYLE_OPTIONS.map((opt) => {
                const words = opt.key === "one_word" ? ["THIS"] : ["THIS", "IS", "WILD"];
                const fmt = (w: string) => (opt.upper ? w : w.toLowerCase());
                return (
                  <label
                    key={opt.key}
                    className={`cursor-pointer border-2 p-2.5 rounded-lg transition ${
                      captionStyle === opt.key ? "border-volt bg-volt/10" : "border-white/12 bg-panel-raised hover:border-white/25"
                    }`}
                  >
                    <input
                      type="radio"
                      name="captionStyle"
                      value={opt.key}
                      checked={captionStyle === opt.key}
                      onChange={() => setCaptionStyle(opt.key)}
                      className="sr-only"
                    />
                    <span className="flex h-16 items-center justify-center gap-1 bg-[#09090e] rounded-md px-1 border border-white/10" style={{ font: opt.font }}>
                      {words.map((w, i) => (
                        <span
                          key={w}
                          style={{
                            color: i === 0 ? opt.active : opt.base,
                            background: i === 0 ? opt.activeBg : undefined,
                            padding: i === 0 && opt.activeBg ? "0 4px" : undefined,
                            borderRadius: 4,
                            WebkitTextStroke: `1px ${opt.stroke}`,
                            textShadow: opt.key === "neon" ? "0 0 8px #00e5ff" : undefined,
                          }}
                        >
                          {fmt(w)}
                        </span>
                      ))}
                    </span>
                    <span className="mt-2 block text-sm font-semibold text-ink">{opt.label}</span>
                    <span className="block text-xs text-muted leading-relaxed">{opt.description}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        {error ? (
          <p role="alert" className="border border-punch/60 bg-punch/15 text-punch px-3 py-2.5 font-semibold rounded-lg text-sm">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || uploading}
          className="display bg-volt px-4 py-4 text-2xl md:text-3xl text-[#101016] font-black rounded-lg shadow-lg hover:bg-[#e4ff78] hover:-translate-y-0.5 active:translate-y-0 transition cursor-pointer disabled:opacity-60 disabled:cursor-wait w-full"
        >
          {uploading ? "Uploading video…" : busy ? "Starting cut…" : "Cut clips"}
        </button>
      </div>
    </form>
  );
}
