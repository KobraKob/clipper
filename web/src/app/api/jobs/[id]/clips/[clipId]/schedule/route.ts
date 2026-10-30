import { NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { getClipVideoFile, getJob, scheduleClip } from "@/lib/store";
import type { Platform } from "@/lib/types";

interface RouteParams {
  params: Promise<{ id: string; clipId: string }>;
}

const BUCKET = "scheduled-videos";
const MAX_CLOUD_VIDEO_BYTES = 1024 * 1024 * 1024;

function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Cloud publishing needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your local .env file.");
  }
  return { url: url.replace(/\/$/, ""), serviceKey };
}

async function cloudSchedule(jobId: string, clipId: string, platform: Platform | "both", scheduledAtIso: string) {
  const scheduledAt = new Date(scheduledAtIso);
  if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() + 2 * 60_000) {
    throw new Error("Choose a publishing time at least two minutes in the future.");
  }

  const { url, serviceKey } = supabaseConfig();
  const job = await getJob(jobId);
  if (!job) throw new Error("Job not found.");
  const clip = job.clips.find((item) => item.id === clipId);
  if (!clip) throw new Error("Clip not found.");
  if (!clip.kept) throw new Error("Keep this clip before scheduling it.");
  if (!clip.seo?.youtube?.title && !clip.seo?.instagram?.caption) {
    throw new Error("Add publishing title or caption before scheduling this clip.");
  }

  const filePath = await getClipVideoFile(jobId, clipId);
  if (!filePath) throw new Error("The rendered clip file is missing. Re-render or export it locally first.");
  const fileStat = await stat(filePath);
  if (fileStat.size <= 0 || fileStat.size > MAX_CLOUD_VIDEO_BYTES) {
    throw new Error("Cloud publishing supports finished MP4 files up to 1 GB.");
  }

  const platforms: Platform[] = platform === "both" ? ["youtube", "instagram"] : [platform];
  const filter = platforms.join(",");
  const existingUrl = new URL(`${url}/rest/v1/scheduled_posts`);
  existingUrl.searchParams.set("job_id", `eq.${jobId}`);
  existingUrl.searchParams.set("clip_id", `eq.${clipId}`);
  existingUrl.searchParams.set("platform", `in.(${filter})`);
  existingUrl.searchParams.set("status", "in.(queued,processing,scheduled,published)");
  existingUrl.searchParams.set("select", "id,platform,status");
  const existing = await fetch(existingUrl, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    cache: "no-store",
  });
  if (!existing.ok) throw new Error(`Could not check existing schedules: ${await existing.text()}`);
  const existingRows = await existing.json();
  if (Array.isArray(existingRows) && existingRows.length) {
    throw new Error("This clip already has an active or published cloud schedule. Cancel it before scheduling again.");
  }

  const storagePath = `${jobId}/${clipId}/${crypto.randomUUID()}.mp4`;
  const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;
  const upload = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodedPath}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "video/mp4",
      "Content-Length": String(fileStat.size),
      "x-upsert": "false",
    },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  if (!upload.ok) {
    throw new Error(`Could not upload finished video to Supabase Storage: ${(await upload.text()).slice(0, 500)}`);
  }

  const metadata = {
    youtube: clip.seo?.youtube ?? {},
    instagram: clip.seo?.instagram ?? {},
    hashtags: clip.seo?.hashtags ?? [],
  };
  const rows = platforms.map((target) => ({
    job_id: jobId,
    clip_id: clipId,
    platform: target,
    scheduled_at: scheduledAt.toISOString(),
    status: "queued",
    storage_path: storagePath,
    metadata,
  }));

  const insert = await fetch(`${url}/rest/v1/scheduled_posts`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(rows),
  });

  if (!insert.ok) {
    await fetch(`${url}/storage/v1/object/${BUCKET}/${encodedPath}`, {
      method: "DELETE",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    }).catch(() => undefined);
    throw new Error(`Could not save cloud publishing schedule: ${(await insert.text()).slice(0, 500)}`);
  }

  const updatedClip = {
    ...clip,
    schedule: { status: "scheduled" as const, platform, scheduled_at: scheduledAt.toISOString() },
  };
  return { ...job, clips: job.clips.map((item) => item.id === clipId ? updatedClip : item) };
}

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { id, clipId } = await params;
    const body = (await req.json()) as { platform?: Platform | "both"; scheduledAtIso?: string };
    const platform = body.platform || "youtube";
    const scheduledAtIso = body.scheduledAtIso;

    if (!scheduledAtIso) {
      return NextResponse.json({ error: "scheduledAtIso timestamp is required." }, { status: 400 });
    }

    // Cloud mode is opt-in. The original filesystem/CLI scheduler remains intact for local development.
    const job = process.env.CLOUD_PUBLISHING_ENABLED === "true"
      ? await cloudSchedule(id, clipId, platform, scheduledAtIso)
      : await scheduleClip(id, clipId, platform, scheduledAtIso);
    return NextResponse.json(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to schedule clip";
    const status = message === "Job not found." || message === "Clip not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
