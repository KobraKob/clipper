import { NextResponse } from "next/server";
import { stat } from "fs/promises";
import { getClipVideoFile, getJob, scheduleClip } from "@/lib/store";
import type { Platform } from "@/lib/types";

interface RouteParams { params: Promise<{ id: string; clipId: string }> }
const BUCKET = "scheduled-videos";
const MAX_BYTES = 1024 * 1024 * 1024;

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in web/.env.local.");
  return { url: url.replace(/\/$/, ""), key };
}

async function loadClip(jobId: string, clipId: string) {
  const job = await getJob(jobId);
  if (!job) throw new Error("Job not found.");
  const clip = job.clips.find((item) => item.id === clipId);
  if (!clip) throw new Error("Clip not found.");
  if (!clip.kept) throw new Error("Keep this clip before scheduling.");
  const file = await getClipVideoFile(jobId, clipId);
  if (!file) throw new Error("Rendered MP4 is missing. Re-render or export the clip first.");
  const fileInfo = await stat(file);
  if (!fileInfo.size || fileInfo.size > MAX_BYTES) throw new Error("Finished MP4 must be between 1 byte and 1 GB.");
  return { job, clip, fileInfo };
}

async function prepare(jobId: string, clipId: string, platform: Platform | "both", scheduledAtIso: string) {
  const when = new Date(scheduledAtIso);
  if (!Number.isFinite(when.getTime()) || when.getTime() < Date.now() + 2 * 60_000) {
    throw new Error("Choose a publishing time at least two minutes in the future.");
  }
  const { url, key } = config();
  const { clip, fileInfo } = await loadClip(jobId, clipId);
  if (platform !== "instagram" && !clip.seo?.youtube?.title) throw new Error("Add a YouTube title before scheduling.");
  if (platform !== "youtube" && !clip.seo?.instagram?.caption) throw new Error("Add an Instagram caption before scheduling.");

  const platforms = platform === "both" ? ["youtube", "instagram"] : [platform];
  const check = new URL(`${url}/rest/v1/scheduled_posts`);
  check.searchParams.set("job_id", `eq.${jobId}`);
  check.searchParams.set("clip_id", `eq.${clipId}`);
  check.searchParams.set("platform", `in.(${platforms.join(",")})`);
  check.searchParams.set("status", "in.(queued,processing,scheduled,published)");
  check.searchParams.set("select", "id");
  const existing = await fetch(check, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" });
  if (!existing.ok) throw new Error(`Could not check existing schedules: ${await existing.text()}`);
  if ((await existing.json() as unknown[]).length) throw new Error("This clip already has an active or published schedule.");

  const storagePath = `${jobId}/${clipId}/${crypto.randomUUID()}.mp4`;
  const encoded = storagePath.split("/").map(encodeURIComponent).join("/");
  const signed = await fetch(`${url}/storage/v1/object/upload/sign/${BUCKET}/${encoded}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ upsert: false }),
  });
  if (!signed.ok) throw new Error(`Could not prepare cloud upload: ${(await signed.text()).slice(0, 400)}`);
  const signedBody = await signed.json() as { url?: string; signedURL?: string; token?: string };
  const signedPath = signedBody.url || signedBody.signedURL;
  if (!signedPath && !signedBody.token) throw new Error("Supabase did not return a signed upload URL.");
  const uploadUrl = signedPath
    ? (signedPath.startsWith("http") ? signedPath : `${url}/storage/v1${signedPath.startsWith("/") ? "" : "/"}${signedPath}`)
    : `${url}/storage/v1/object/upload/sign/${BUCKET}/${encoded}?token=${encodeURIComponent(signedBody.token!)}`;
  return NextResponse.json({ uploadUrl, storagePath, size: fileInfo.size, fileUrl: `/api/jobs/${jobId}/clips/${clipId}` });
}

async function complete(jobId: string, clipId: string, platform: Platform | "both", scheduledAtIso: string, storagePath: string) {
  const when = new Date(scheduledAtIso);
  if (!Number.isFinite(when.getTime()) || when.getTime() < Date.now() + 2 * 60_000) throw new Error("Publishing time must be at least two minutes in the future.");
  if (!storagePath || !storagePath.startsWith(`${jobId}/${clipId}/`) || !storagePath.endsWith(".mp4")) throw new Error("Invalid upload reference. Retry the upload.");
  const { url, key } = config();
  const { job, clip } = await loadClip(jobId, clipId);
  const platforms: Platform[] = platform === "both" ? ["youtube", "instagram"] : [platform];
  const metadata = { youtube: clip.seo?.youtube ?? {}, instagram: clip.seo?.instagram ?? {}, hashtags: clip.seo?.hashtags ?? [] };
  const rows = platforms.map((target) => ({
    job_id: jobId, clip_id: clipId, platform: target, scheduled_at: when.toISOString(),
    status: "queued", storage_path: storagePath, metadata,
  }));
  const inserted = await fetch(`${url}/rest/v1/scheduled_posts`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(rows),
  });
  if (!inserted.ok) throw new Error(`Upload completed, but saving the schedule failed: ${(await inserted.text()).slice(0, 500)}`);
  const updated = { ...clip, schedule: { status: "scheduled" as const, platform, scheduled_at: when.toISOString() } };
  return { ...job, clips: job.clips.map((item) => item.id === clipId ? updated : item) };
}

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { id, clipId } = await params;
    const body = await req.json() as { action?: "prepare" | "complete" | "legacy"; platform?: Platform | "both"; scheduledAtIso?: string; storagePath?: string };
    const platform = body.platform || "youtube";
    if (!body.scheduledAtIso) return NextResponse.json({ error: "scheduledAtIso is required." }, { status: 400 });

    if (process.env.CLOUD_PUBLISHING_ENABLED !== "true" || body.action === "legacy") {
      const job = await scheduleClip(id, clipId, platform, body.scheduledAtIso);
      return body.action === "prepare"
        ? NextResponse.json({ mode: "local", job })
        : NextResponse.json(job);
    }
    if (body.action === "prepare") return await prepare(id, clipId, platform, body.scheduledAtIso);
    if (body.action === "complete") {
      if (!body.storagePath) return NextResponse.json({ error: "storagePath is required." }, { status: 400 });
      return NextResponse.json(await complete(id, clipId, platform, body.scheduledAtIso, body.storagePath));
    }
    return NextResponse.json({ error: "Unknown scheduling action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scheduling failed.";
    const status = message === "Job not found." || message === "Clip not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
