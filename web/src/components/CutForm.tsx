"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createJob, providerNote, uploadSoundtrack, uploadVideo } from "@/lib/api";
import { CAPTION_STYLE_OPTIONS, type CaptionCategory } from "@/lib/captionStyles";
import type { Layout, Provider, VideoEncoder } from "@/lib/types";

export function CutForm() {
  const router = useRouter();
  const [sourceUrl, setSourceUrl] = useState("");
  const [clipCount, setClipCount] = useState(5);
  const [provider, setProvider] = useState<Provider>("local");
  const [vertical, setVertical] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [captionStyle, setCaptionStyle] = useState("bold_pop");
  const [captionCategory, setCaptionCategory] = useState<"all" | CaptionCategory>("all");
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
  const [soundtrackPath, setSoundtrackPath] = useState("");
  const [soundtrackName, setSoundtrackName] = useState("");
  const [soundtrackVolume, setSoundtrackVolume] = useState(0.18);
  const [uploadingSoundtrack, setUploadingSoundtrack] = useState(false);
  const selectedCaptionOption = CAPTION_STYLE_OPTIONS.find((option) => option.key === captionStyle) || CAPTION_STYLE_OPTIONS[0];

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
        soundtrackPath: soundtrackPath || undefined,
        soundtrackVolume,
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

  async function handleSoundtrackSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError("");
    setUploadingSoundtrack(true);
    try {
      const uploaded = await uploadSoundtrack(file);
      setSoundtrackPath(uploaded.path);
      setSoundtrackName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload soundtrack.");
    } finally {
      setUploadingSoundtrack(false);
      e.target.value = "";
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

        <fieldset className="flex flex-col gap-3 border border-white/12 bg-panel-inset/50 p-4 rounded-lg">
          <legend className="px-1 font-semibold text-ink">Optional soundtrack</legend>
          <p className="text-xs leading-relaxed text-muted">
            Upload music for every cut. Clipper analyses its energy and tempo, chooses a strong section for each clip, and ducks music under speech.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="cursor-pointer border border-white/20 bg-panel-raised px-3.5 py-2 text-sm font-semibold text-ink rounded hover:border-volt hover:text-volt transition">
              {uploadingSoundtrack ? "Uploading soundtrack…" : soundtrackName ? "Replace soundtrack" : "Choose audio…"}
              <input
                type="file"
                accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/*"
                disabled={uploadingSoundtrack || busy}
                className="sr-only"
                onChange={handleSoundtrackSelected}
              />
            </label>
            <span className="min-w-0 flex-1 text-xs text-muted">{soundtrackName || "MP3, WAV, M4A, AAC, OGG or FLAC · up to 100 MB"}</span>
            {soundtrackPath ? (
              <button type="button" disabled={busy} onClick={() => { setSoundtrackPath(""); setSoundtrackName(""); }} className="text-xs underline text-muted hover:text-volt">
                Remove
              </button>
            ) : null}
          </div>
          {soundtrackPath ? (
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">
              Music level
              <select value={soundtrackVolume} disabled={busy} onChange={(event) => setSoundtrackVolume(Number(event.target.value))} className="w-full max-w-xs border border-white/20 bg-panel-inset px-3 py-2 text-sm text-ink rounded-lg">
                <option value={0.12}>Subtle · 12%</option>
                <option value={0.18}>Balanced · 18%</option>
                <option value={0.25}>Noticeable · 25%</option>
                <option value={0.32}>Loud · 32%</option>
              </select>
            </label>
          ) : null}
        </fieldset>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="font-semibold text-ink">Target Clips Count</span>
            <input
              type="number"
              min={1}
              max={10}
              value={clipCount}
              onChange={(e) => setClipCount(Math.max(1, Math.min(10, Number(e.target.value))))}
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
          <fieldset className="flex flex-col gap-3 border border-white/12 bg-panel-inset/40 p-4 md:p-5 rounded-xl">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <legend className="font-semibold text-ink">Caption style</legend>
                <p className="mt-1 text-xs text-muted">Choose a look. Preview changes instantly; the selected style is burned into the export.</p>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-ice">{CAPTION_STYLE_OPTIONS.length} styles</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] items-stretch">
              <div className="flex min-h-24 flex-col justify-center rounded-lg border border-white/10 bg-[#080b11] px-4 py-3">
                <span className="text-[9px] font-bold uppercase tracking-[.16em] text-muted">Live preview · {selectedCaptionOption.label}</span>
                <div className="mt-3 flex min-h-9 flex-wrap items-center justify-center gap-x-2 gap-y-1" aria-label={`Preview of ${selectedCaptionOption.label} captions`}>
                  {(captionStyle === "one_word" ? ["THIS"] : ["MAKE", "IT", "COUNT"]).map((word, index) => {
                    const active = index === (captionStyle === "one_word" ? 0 : 1);
                    const displayWord = selectedCaptionOption.upper ? word : word.toLowerCase();
                    return (
                      <span
                        key={word}
                        style={{
                          font: selectedCaptionOption.font,
                          color: active ? selectedCaptionOption.active : selectedCaptionOption.base,
                          background: active ? selectedCaptionOption.activeBg : undefined,
                          padding: active && selectedCaptionOption.activeBg ? "2px 5px" : undefined,
                          borderRadius: 4,
                          WebkitTextStroke: `0.7px ${selectedCaptionOption.stroke}`,
                          textShadow: selectedCaptionOption.glow ? `0 0 8px ${selectedCaptionOption.glow}` : undefined,
                        }}
                      >
                        {displayWord}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-col justify-center gap-1 rounded-lg border border-volt/25 bg-volt/5 px-4 py-3 sm:max-w-56">
                <span className="text-[10px] font-bold uppercase tracking-wider text-volt">Selected look</span>
                <strong className="text-sm text-ink">{selectedCaptionOption.label}</strong>
                <span className="text-xs leading-relaxed text-muted">{selectedCaptionOption.description}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter caption styles">
              {([
                ["all", `All styles · ${CAPTION_STYLE_OPTIONS.length}`],
                ["bold", "Bold & punchy"],
                ["minimal", "Clean & minimal"],
                ["creative", "Creative"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={captionCategory === value}
                  onClick={() => setCaptionCategory(value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${captionCategory === value ? "border-volt bg-volt text-[#101016]" : "border-white/15 bg-panel-raised text-muted hover:border-white/30 hover:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {CAPTION_STYLE_OPTIONS.filter((opt) => captionCategory === "all" || opt.category === captionCategory).map((opt) => (
                <label
                  key={opt.key}
                  className={`group cursor-pointer rounded-xl border p-3 transition ${captionStyle === opt.key ? "border-volt bg-volt/8 shadow-[0_0_0_1px_rgba(201,255,63,.12)]" : "border-white/12 bg-panel-raised/70 hover:border-white/30"}`}
                >
                  <input
                    type="radio"
                    name="captionStyle"
                    value={opt.key}
                    checked={captionStyle === opt.key}
                    onChange={() => setCaptionStyle(opt.key)}
                    className="sr-only"
                  />
                  <span className={`flex h-16 items-center justify-center gap-1 overflow-hidden rounded-lg border px-1 ${captionStyle === opt.key ? "border-volt/30 bg-[#07090e]" : "border-white/10 bg-[#09090e]"}`}>
                    {(opt.key === "one_word" ? ["THIS"] : ["MAKE", "IT", "COUNT"]).map((word, index) => {
                      const active = index === (opt.key === "one_word" ? 0 : 1);
                      return (
                        <span
                          key={word}
                          style={{
                            font: opt.font,
                            color: active ? opt.active : opt.base,
                            background: active ? opt.activeBg : undefined,
                            padding: active && opt.activeBg ? "0 4px" : undefined,
                            borderRadius: 4,
                            WebkitTextStroke: `0.7px ${opt.stroke}`,
                            textShadow: opt.glow ? `0 0 8px ${opt.glow}` : undefined,
                          }}
                        >
                          {opt.upper ? word : word.toLowerCase()}
                        </span>
                      );
                    })}
                  </span>
                  <span className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink">{opt.label}</span>
                    {captionStyle === opt.key ? <span className="text-[9px] font-bold uppercase tracking-wide text-volt">Selected</span> : null}
                  </span>
                  <span className="mt-1 block min-h-10 text-xs leading-relaxed text-muted">{opt.description}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <div className="rounded-lg border border-dashed border-white/15 bg-panel-inset/50 p-4">
            <p className="text-sm font-semibold text-ink">Captions are off</p>
            <p className="mt-1 text-xs text-muted">Turn on animated captions above to choose one of {CAPTION_STYLE_OPTIONS.length} styles.</p>
          </div>
        )}

        {error ? (
          <p role="alert" className="border border-punch/60 bg-punch/15 text-punch px-3 py-2.5 font-semibold rounded-lg text-sm">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || uploading || uploadingSoundtrack}
          className="display bg-volt px-4 py-4 text-2xl md:text-3xl text-[#101016] font-black rounded-lg shadow-lg hover:bg-[#e4ff78] hover:-translate-y-0.5 active:translate-y-0 transition cursor-pointer disabled:opacity-60 disabled:cursor-wait w-full"
        >
          {uploading ? "Uploading video…" : busy ? "Starting cut…" : "Cut clips"}
        </button>
      </div>
    </form>
  );
}
