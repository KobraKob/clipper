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
  patch: { kept?: boolean; start?: number; end?: number },
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
): Promise<JobView> {
  const res = await fetch(`/api/jobs/${jobId}/clips/${clipId}/rerender`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start, end }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export function providerNote(provider: Provider): string {
  return provider === "local"
    ? "Audio and scoring stay on this machine."
    : "Audio or transcript text is sent to Groq. Use local for private material.";
}

export async function publishClip(jobId: string, clipId: string, platforms: Platform[]): Promise<JobView> {
  const res = await fetch(`/api/jobs/${jobId}/clips/${clipId}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platforms }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function deleteJob(id: string): Promise<void> {
  const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await parseError(res));
}
