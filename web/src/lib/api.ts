import type { CreateJobInput, JobView, Provider } from "./types";

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || res.statusText;
  } catch {
    return res.statusText;
  }
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

export function providerNote(provider: Provider): string {
  return provider === "local"
    ? "Audio and scoring stay on this machine."
    : "Audio or transcript text is sent to Groq. Use local for private material.";
}
