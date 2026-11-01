import type { CreateJobInput, JobView, Platform, Provider } from "./types";

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || res.statusText;
  } catch {
    return res.statusText;
  }
}

export async function uploadVideo(
  file: File,
): Promise<{ path: string; fileName: string; originalName: string; size: number }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function uploadSoundtrack(
  file: File,
): Promise<{ path: string; fileName: string; originalName: string; size: number }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/upload/soundtrack", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function createJob(input: CreateJobInput): Promise<JobView> {
  const res = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchJob(id: string): Promise<JobView> {
  const res = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchJobs(): Promise<JobView[]> {
  const res = await fetch("/api/jobs", { cache: "no-store" });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function patchClip(
  jobId: string,
  clipId: string,
  patch: { kept?: boolean; start?: number; end?: number; title?: string; description?: string; caption?: string; hashtags?: string[] },
): Promise<JobView> {
  const res = await fetch(`/api/jobs/${jobId}/clips/${clipId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function rerenderClip(
  jobId: string,
  clipId: string,
  start: number,
  end: number,
  captionStyle?: string,
): Promise<JobView> {
  const res = await fetch(`/api/jobs/${jobId}/clips/${clipId}/rerender`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start, end, captionStyle }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export function providerNote(provider: Provider): string {
  if (provider === "local") {
    return "Audio and scoring stay on this machine.";
  }
  if (provider === "openrouter") {
    return "LLM scoring powered by OpenRouter (NVIDIA Nemotron 3 Ultra 550B). Audio transcribed via Groq/Whisper.";
  }
  return "Audio and transcript text are sent to Groq. Use local for private material.";
}

export async function publishClip(
  jobId: string,
  clipId: string,
  platforms: Platform[],
  privacy?: "private" | "unlisted" | "public",
  reauth?: boolean,
): Promise<JobView> {
  const res = await fetch(`/api/jobs/${jobId}/clips/${clipId}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platforms, privacy, reauth }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function resetYouTubeAuth(): Promise<{ success: boolean; message: string }> {
  const res = await fetch("/api/youtube/reset", { method: "POST" });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function scheduleClip(
  jobId: string,
  clipId: string,
  platform: Platform | "both",
  scheduledAtIso: string,
): Promise<JobView> {
  const res = await fetch(`/api/jobs/${jobId}/clips/${clipId}/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform, scheduledAtIso }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchClipAnalytics(jobId: string, clipId: string): Promise<JobView> {
  const res = await fetch(`/api/jobs/${jobId}/clips/${clipId}/analytics`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function selectTitleVariant(
  jobId: string,
  clipId: string,
  variantId: string,
): Promise<JobView> {
  const res = await fetch(`/api/jobs/${jobId}/clips/${clipId}/title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variantId }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function deleteJob(id: string): Promise<void> {
  const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function fetchJobLogs(id: string): Promise<{
  id: string;
  status: string;
  stageId: string;
  progress: number;
  progressMessage?: string;
  error?: string;
  logs: string;
}> {
  const res = await fetch(`/api/jobs/${id}/logs`, { cache: "no-store" });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}



export type ScheduleProgress = {
  phase: "preparing" | "uploading" | "saving" | "success";
  percent: number;
  loadedBytes: number;
  totalBytes: number;
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function xhrUpload(url: string, file: Blob, onProgress: (loaded: number, total: number) => void, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.timeout = timeoutMs;
    xhr.setRequestHeader("Content-Type", "video/mp4");
    xhr.upload.onprogress = (event) => onProgress(event.loaded, event.lengthComputable ? event.total : file.size);
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300
      ? resolve()
      : reject(new Error(`Cloud storage upload failed (${xhr.status}): ${xhr.responseText || xhr.statusText}`));
    xhr.onerror = () => reject(new Error("Network error during cloud upload. Check your connection and retry."));
    xhr.ontimeout = () => reject(new Error("Cloud upload timed out after 10 minutes. Check your connection and retry."));
    xhr.onabort = () => reject(new Error("Cloud upload was cancelled."));
    xhr.send(file);
  });
}

export async function scheduleClipWithProgress(
  jobId: string,
  clipId: string,
  platform: Platform | "both",
  scheduledAtIso: string,
  onProgress: (progress: ScheduleProgress) => void,
  timeoutMs = 10 * 60 * 1000,
): Promise<JobView> {
  const post = async (action: "prepare" | "complete", storagePath?: string) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`/api/jobs/${jobId}/clips/${clipId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, platform, scheduledAtIso, storagePath }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await parseError(response));
      return response.json();
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Scheduling request timed out. Retry.");
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  };

  onProgress({ phase: "preparing", percent: 0, loadedBytes: 0, totalBytes: 0 });
  let prepared: { uploadUrl: string; storagePath: string; size: number; fileUrl: string };
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      // Obtain a fresh one-time signed URL on retry; failed uploads may invalidate the previous URL.
      prepared = await post("prepare") as { uploadUrl: string; storagePath: string; size: number; fileUrl: string };
      onProgress({ phase: "preparing", percent: 0, loadedBytes: 0, totalBytes: prepared.size });
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      let blob: Blob;
      try {
        const response = await fetch(prepared.fileUrl, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`Could not read rendered MP4 (${response.status}).`);
        blob = await response.blob();
      } finally {
        window.clearTimeout(timer);
      }
      if (blob.size !== prepared.size) throw new Error("Downloaded clip size did not match the prepared file. Retry.");
      onProgress({ phase: "uploading", percent: 0, loadedBytes: 0, totalBytes: blob.size });
      await xhrUpload(prepared.uploadUrl, blob, (loaded, total) => {
        onProgress({ phase: "uploading", percent: total ? Math.min(100, Math.round(loaded / total * 100)) : 0, loadedBytes: loaded, totalBytes: total });
      }, timeoutMs);
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    }
  }
  if (lastError) throw lastError;

  onProgress({ phase: "saving", percent: 100, loadedBytes: prepared.size, totalBytes: prepared.size });
  const result = await post("complete", prepared.storagePath) as JobView;
  onProgress({ phase: "success", percent: 100, loadedBytes: prepared.size, totalBytes: prepared.size });
  return result;
}
