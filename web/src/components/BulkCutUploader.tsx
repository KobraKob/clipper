"use client";

import { useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { createJob, uploadSoundtrack, uploadVideo } from "@/lib/api";
import type { Provider } from "@/lib/types";
import { CAPTION_STYLE_OPTIONS } from "@/lib/captionStyles";

type BulkCutUploaderProps = {
  onCreated: () => Promise<void> | void;
};

type BatchResult = {
  created: number;
  failures: string[];
};

function fileKey(file: File) {
  return [file.name, file.size, file.lastModified].join(":");
}

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function isVideoFile(file: File) {
  return file.type.startsWith("video/") || /\.(mp4|mov|m4v|mkv|webm|avi|mpeg|mpg|wmv|flv)$/i.test(file.name);
}

export function BulkCutUploader({ onCreated }: BulkCutUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [provider, setProvider] = useState<Provider>("local");
  const [clipCount, setClipCount] = useState(5);
  const [vertical, setVertical] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [captionStyle, setCaptionStyle] = useState("bold_pop");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ index: 0, total: 0, percent: 0, label: "" });
  const [selectionError, setSelectionError] = useState("");
  const [result, setResult] = useState<BatchResult | null>(null);
  const [soundtrackPath, setSoundtrackPath] = useState("");
  const [soundtrackName, setSoundtrackName] = useState("");
  const [soundtrackVolume, setSoundtrackVolume] = useState(0.18);
  const [uploadingSoundtrack, setUploadingSoundtrack] = useState(false);

  function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selected.length === 0) return;

    const valid = selected.filter(isVideoFile);
    const rejected = selected.length - valid.length;
    setSelectionError(rejected > 0 ? `${rejected} unsupported file(s) skipped. Select video files only.` : "");
    setResult(null);
    setFiles((current) => {
      const known = new Set(current.map(fileKey));
      return [...current, ...valid.filter((file) => !known.has(fileKey(file)))];
    });
  }

  function removeFile(target: File) {
    setFiles((current) => current.filter((file) => fileKey(file) !== fileKey(target)));
  }

  async function handleSoundtrackSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectionError("");
    setUploadingSoundtrack(true);
    try {
      const uploaded = await uploadSoundtrack(file);
      setSoundtrackPath(uploaded.path);
      setSoundtrackName(file.name);
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : "Failed to upload soundtrack.");
    } finally {
      setUploadingSoundtrack(false);
      event.target.value = "";
    }
  }

  async function handleBulkCut(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.length === 0 || busy) return;

    const queue = [...files];
    const failures: string[] = [];
    const retryFiles: File[] = [];
    let created = 0;

    setBusy(true);
    setResult(null);
    setSelectionError("");
    setProgress({ index: 0, total: queue.length, percent: 0, label: "Preparing batch…" });

    for (let index = 0; index < queue.length; index += 1) {
      const file = queue[index];
      try {
        setProgress({
          index: index + 1,
          total: queue.length,
          percent: Math.round((index / queue.length) * 100),
          label: `Uploading ${file.name}`,
        });
        const uploaded = await uploadVideo(file);

        setProgress({
          index: index + 1,
          total: queue.length,
          percent: Math.round(((index + 0.7) / queue.length) * 100),
          label: `Starting cut for ${file.name}`,
        });

        await createJob({
          sourceUrl: uploaded.path,
          clipCount,
          provider,
          vertical,
          captions,
          captionStyle,
          layout: "fill",
          videoEncoder: "auto",
          trimSilence: false,
          hookOverlay: true,
          progressBar: false,
          loudnorm: true,
          soundtrackPath: soundtrackPath || undefined,
          soundtrackVolume,
        });
        created += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown upload or cut error.";
        failures.push(`${file.name}: ${message}`);
        retryFiles.push(file);
      }

      setProgress({
        index: index + 1,
        total: queue.length,
        percent: Math.round(((index + 1) / queue.length) * 100),
        label: `Processed ${index + 1} of ${queue.length}`,
      });
    }

    setFiles(retryFiles);
    setResult({ created, failures });
    setBusy(false);
    setProgress({ index: 0, total: 0, percent: 0, label: "" });
    if (created > 0) {
      try {
        await onCreated();
      } catch {
        // The jobs were created even if the library refresh fails.
      }
    }
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <section className="ux-library-batch" aria-labelledby="bulk-cut-title">
      <div className="ux-library-batch-head">
        <div className="ux-library-batch-title">
          <span className="ux-panel-eyebrow">BATCH INGEST / MULTI-CUT</span>
          <h2 id="bulk-cut-title">Cut a whole folder.</h2>
          <p>Select multiple videos. Clipper uploads each file and creates a separate cut job for the library.</p>
        </div>
        <div className="ux-batch-count" aria-label={`${files.length} selected videos`}>
          <strong>{String(files.length).padStart(2, "0")}</strong>
          <span>VIDEOS</span>
        </div>
      </div>

      <form onSubmit={handleBulkCut}>
        <div className="ux-batch-dropzone">
          <span className="ux-batch-upload-icon" aria-hidden="true">⇧</span>
          <div className="ux-batch-drop-copy">
            <strong>{files.length ? `${files.length} video${files.length === 1 ? "" : "s"} ready` : "Add videos to the batch"}</strong>
            <span>Choose several files in one selection. Add more before starting.</span>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="video/*,.mkv,.avi,.mov,.mp4,.webm"
            multiple
            disabled={busy || uploadingSoundtrack}
            onChange={handleFilesSelected}
            className="sr-only"
            aria-label="Choose multiple video files"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="ux-batch-select-button"
          >
            {files.length ? "Add more videos +" : "Choose videos +"}
          </button>
        </div>

        {selectionError ? <p className="ux-batch-error" role="alert">{selectionError}</p> : null}

        {files.length > 0 ? (
          <div className="ux-batch-queue">
            <div className="ux-batch-queue-heading">
              <span>UPLOAD QUEUE</span>
              <span>{formatSize(totalBytes)} TOTAL</span>
            </div>
            <ul>
              {files.map((file) => (
                <li key={fileKey(file)}>
                  <span className="ux-batch-file-icon" aria-hidden="true">▶</span>
                  <span className="ux-batch-file-name">
                    <strong>{file.name}</strong>
                    <small>{formatSize(file.size)}</small>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removeFile(file)}
                    aria-label={`Remove ${file.name}`}
                    className="ux-batch-remove"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="ux-batch-options" aria-label="Optional soundtrack settings">
          <label className="ux-batch-option">
            <span>OPTIONAL SHARED SOUNDTRACK</span>
            <input
              type="file"
              accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/*"
              disabled={busy || uploadingSoundtrack}
              onChange={handleSoundtrackSelected}
            />
            <small>{uploadingSoundtrack ? "Uploading…" : soundtrackName || "Upload once to use across this batch (max 100 MB)"}</small>
          </label>
          {soundtrackPath ? (
            <label className="ux-batch-option">
              <span>MUSIC LEVEL</span>
              <select value={soundtrackVolume} disabled={busy} onChange={(event) => setSoundtrackVolume(Number(event.target.value))}>
                <option value={0.12}>Subtle · 12%</option>
                <option value={0.18}>Balanced · 18%</option>
                <option value={0.25}>Noticeable · 25%</option>
                <option value={0.32}>Loud · 32%</option>
              </select>
              <button type="button" disabled={busy} onClick={() => { setSoundtrackPath(""); setSoundtrackName(""); }} className="ux-batch-remove">Remove soundtrack</button>
            </label>
          ) : null}
        </div>

        <div className="ux-batch-options">
          <label className="ux-batch-option">
            <span>CLIP COUNT / VIDEO</span>
            <select
              value={clipCount}
              disabled={busy}
              onChange={(event) => setClipCount(Math.min(10, Math.max(1, Number(event.target.value) || 5)))}
            >
              {[3, 5, 8, 10].map((count) => <option key={count} value={count}>{count} clips</option>)}
            </select>
          </label>
          <label className="ux-batch-option">
            <span>PROCESSING ENGINE</span>
            <select value={provider} disabled={busy} onChange={(event) => setProvider(event.target.value as Provider)}>
              <option value="local">Local / private</option>
              <option value="groq">Groq / cloud</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </label>
          <label className="ux-batch-option">
            <span>CAPTION STYLE</span>
            <select value={captionStyle} disabled={busy || !captions} onChange={(event) => setCaptionStyle(event.target.value)}>
              {CAPTION_STYLE_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
            <small>{CAPTION_STYLE_OPTIONS.find((option) => option.key === captionStyle)?.description}</small>
          </label>
          <div className="ux-batch-toggles">
            <label><input type="checkbox" checked={vertical} disabled={busy} onChange={(event) => setVertical(event.target.checked)} /> Vertical 9:16</label>
            <label><input type="checkbox" checked={captions} disabled={busy} onChange={(event) => setCaptions(event.target.checked)} /> Animated captions</label>
          </div>
        </div>

        {busy ? (
          <div className="ux-batch-progress" role="status" aria-live="polite">
            <div className="ux-batch-progress-copy">
              <span>{progress.label}</span>
              <strong>{progress.index}/{progress.total}</strong>
            </div>
            <div className="ux-batch-progress-track"><span style={{ width: `${progress.percent}%` }} /></div>
          </div>
        ) : null}

        {result ? (
          <div className={`ux-batch-result ${result.failures.length ? "has-errors" : ""}`} role="status" aria-live="polite">
            <strong>{result.created} cut job${result.created === 1 ? "" : "s"} created.</strong>
            {result.failures.length ? (
              <ul>{result.failures.map((failure) => <li key={failure}>{failure}</li>)}</ul>
            ) : (
              <span>New jobs are now listed below. Failed files, if any, remain in the queue for retry.</span>
            )}
          </div>
        ) : null}

        <div className="ux-batch-actions">
          <span>Each video becomes its own library job.</span>
          <button type="submit" disabled={busy || files.length === 0} className="ux-batch-start">
            {busy ? "Uploading and starting cuts…" : `Upload & cut ${files.length || ""} ${files.length === 1 ? "video" : "videos"}`}
            {!busy ? <span aria-hidden="true">↗</span> : null}
          </button>
        </div>
        <p className="ux-batch-note">Large batches start multiple background jobs. Keep batches moderate on machines with limited CPU or GPU capacity.</p>
      </form>
    </section>
  );
}
