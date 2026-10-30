import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-cron-secret",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const graphVersion = Deno.env.get("INSTAGRAM_GRAPH_VERSION") || "v22.0";

type ScheduledPost = {
  id: string;
  job_id: string;
  clip_id: string;
  platform: "youtube" | "instagram";
  scheduled_at: string;
  status: string;
  storage_path: string;
  metadata: Record<string, unknown>;
  attempts: number;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function db(path: string, init: RequestInit = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Database request failed (${response.status}): ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function signedVideoUrl(storagePath: string): Promise<string> {
  const encoded = storagePath.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${supabaseUrl}/storage/v1/object/sign/scheduled-videos/${encoded}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: 86400 }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Could not create video URL: ${JSON.stringify(data).slice(0, 400)}`);
  const path = data.signedURL || data.signedUrl;
  if (!path) throw new Error("Storage did not return a signed video URL.");
  return path.startsWith("http") ? path : `${supabaseUrl}/storage/v1${path}`;
}

function metadataFor(post: ScheduledPost) {
  return (post.metadata || {}) as {
    youtube?: { title?: string; description?: string; tags?: string[] };
    instagram?: { caption?: string };
    hashtags?: string[];
  };
}

async function youtubeAccessToken(): Promise<string> {
  const clientId = Deno.env.get("YOUTUBE_CLIENT_ID");
  const clientSecret = Deno.env.get("YOUTUBE_CLIENT_SECRET");
  const refreshToken = Deno.env.get("YOUTUBE_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("YouTube cloud credentials are not configured. Set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN.");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`YouTube token refresh failed: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return data.access_token as string;
}

async function publishYouTube(post: ScheduledPost, videoUrl: string) {
  const accessToken = await youtubeAccessToken();
  const meta = metadataFor(post);
  const title = String(meta.youtube?.title || "Chop Shop Short").slice(0, 100);
  let description = String(meta.youtube?.description || "");
  if (!description.toLowerCase().includes("#shorts")) description = `${description.trim()}\n#Shorts`.trim();
  const tags = Array.isArray(meta.youtube?.tags) ? meta.youtube!.tags!.slice(0, 500) : [];
  const scheduledAt = new Date(post.scheduled_at).toISOString();
  if (new Date(scheduledAt).getTime() <= Date.now() + 60_000) {
    throw new Error("YouTube posts must be uploaded at least one minute before their scheduled publication time.");
  }

  const source = await fetch(videoUrl, { method: "HEAD" });
  if (!source.ok) throw new Error("Could not inspect the stored video.");
  const size = source.headers.get("content-length");
  if (!size) throw new Error("Stored video did not provide a content length.");

  const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": size,
    },
    body: JSON.stringify({
      snippet: { title, description: description.slice(0, 5000), tags, categoryId: "22" },
      status: {
        privacyStatus: "private",
        publishAt: scheduledAt,
        selfDeclaredMadeForKids: false,
      },
    }),
  });
  if (!start.ok) throw new Error(`YouTube upload session failed: ${(await start.text()).slice(0, 500)}`);
  const uploadUrl = start.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube did not return a resumable upload URL.");

  const video = await fetch(videoUrl);
  if (!video.ok || !video.body) throw new Error("Could not download scheduled video from storage.");
  const upload = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": size },
    body: video.body,
  });
  const result = await upload.json();
  if (!upload.ok || !result.id) {
    throw new Error(`YouTube video upload failed: ${JSON.stringify(result).slice(0, 500)}`);
  }
  return { id: result.id as string, url: `https://youtube.com/shorts/${result.id}` };
}

async function publishInstagram(post: ScheduledPost, videoUrl: string) {
  const token = Deno.env.get("INSTAGRAM_ACCESS_TOKEN");
  const userId = Deno.env.get("INSTAGRAM_USER_ID");
  if (!token || !userId) {
    throw new Error("Instagram cloud credentials are not configured. Set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID.");
  }
  const meta = metadataFor(post);
  const caption = String(meta.instagram?.caption || "");
  const tags = Array.isArray(meta.hashtags) ? meta.hashtags : [];
  const uniqueTags = [...new Set(tags.map((tag) => `#${String(tag).replace(/^#+/, "").replace(/\s+/g, "")}`))];
  const finalCaption = [caption, uniqueTags.join(" ")].filter(Boolean).join("\n\n").slice(0, 2200);
  const graphHost = Deno.env.get("INSTAGRAM_FLAVOR") === "instagram" ? "graph.instagram.com" : "graph.facebook.com";
  const base = `https://${graphHost}/${graphVersion}`;

  const create = await fetch(`${base}/${encodeURIComponent(userId)}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      media_type: "REELS",
      video_url: videoUrl,
      caption: finalCaption,
      share_to_feed: "true",
      access_token: token,
    }),
  });
  const container = await create.json();
  if (!create.ok || !container.id) {
    throw new Error(`Instagram container creation failed: ${JSON.stringify(container).slice(0, 500)}`);
  }

  let ready = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const statusResponse = await fetch(
      `${base}/${container.id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`,
    );
    const status = await statusResponse.json();
    if (!statusResponse.ok) throw new Error(`Instagram status check failed: ${JSON.stringify(status).slice(0, 400)}`);
    if (status.status_code === "FINISHED") {
      ready = true;
      break;
    }
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new Error(`Instagram processing ${status.status_code}: ${status.status || "No details"}`);
    }
  }
  if (!ready) throw new Error("Instagram video processing timed out. Retry the post from Chop Shop.");

  const publish = await fetch(`${base}/${encodeURIComponent(userId)}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: container.id, access_token: token }),
  });
  const result = await publish.json();
  if (!publish.ok || !result.id) {
    throw new Error(`Instagram publish failed: ${JSON.stringify(result).slice(0, 500)}`);
  }

  let permalink: string | null = null;
  try {
    const infoResponse = await fetch(
      `${base}/${result.id}?fields=permalink&access_token=${encodeURIComponent(token)}`,
    );
    const info = await infoResponse.json();
    permalink = info.permalink || null;
  } catch {
    // Permalink is optional; publishing already succeeded.
  }
  return { id: result.id as string, url: permalink };
}

async function claim(post: ScheduledPost): Promise<boolean> {
  const rows = await db(
    `scheduled_posts?id=eq.${post.id}&status=eq.queued&select=id`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: "processing",
        locked_at: new Date().toISOString(),
        attempts: post.attempts + 1,
        last_error: null,
      }),
    },
  );
  return Array.isArray(rows) && rows.length === 1;
}

async function updatePost(id: string, patch: Record<string, unknown>) {
  await db(`scheduled_posts?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

async function authorizedSchedulerRequest(req: Request): Promise<boolean> {
  const candidate = req.headers.get("x-cron-secret");
  if (!candidate) return false;
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/verify_chop_shop_cron_secret`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ candidate }),
  });
  if (!response.ok) return false;
  return await response.json() === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase worker environment is incomplete." }, 500);
  if (!(await authorizedSchedulerRequest(req))) {
    return json({ error: "Unauthorized scheduler invocation." }, 401);
  }

  const now = new Date();
  const due = now.toISOString();
  const youtubeWindow = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
  const [instagramPosts, youtubePosts, completedYoutube] = await Promise.all([
    db(`scheduled_posts?status=eq.queued&platform=eq.instagram&scheduled_at=lte.${encodeURIComponent(due)}&order=scheduled_at.asc&limit=3`),
    db(`scheduled_posts?status=eq.queued&platform=eq.youtube&scheduled_at=lte.${encodeURIComponent(youtubeWindow)}&order=scheduled_at.asc&limit=3`),
    db(`scheduled_posts?status=eq.scheduled&platform=eq.youtube&scheduled_at=lte.${encodeURIComponent(due)}&select=id,provider_post_id`),
  ]);

  for (const row of completedYoutube as { id: string; provider_post_id: string | null }[]) {
    if (!row.provider_post_id) continue;
    try {
      const token = await youtubeAccessToken();
      const check = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${encodeURIComponent(row.provider_post_id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await check.json();
      if (check.ok && data.items?.[0]?.status?.privacyStatus === "public") {
        await updatePost(row.id, { status: "published", published_at: now.toISOString(), locked_at: null });
      }
    } catch {
      // Leave it in scheduled state; a later cron tick can verify publication.
    }
  }

  const posts = [...(instagramPosts as ScheduledPost[]), ...(youtubePosts as ScheduledPost[])];
  const results: Array<{ id: string; status: string; error?: string }> = [];
  for (const post of posts) {
    if (!(await claim(post))) continue;
    try {
      const videoUrl = await signedVideoUrl(post.storage_path);
      const published = post.platform === "youtube"
        ? await publishYouTube(post, videoUrl)
        : await publishInstagram(post, videoUrl);
      await updatePost(post.id, {
        status: post.platform === "youtube" ? "scheduled" : "published",
        provider_post_id: published.id,
        permalink: published.url,
        published_at: post.platform === "instagram" ? new Date().toISOString() : null,
        locked_at: null,
        last_error: null,
      });
      results.push({ id: post.id, status: post.platform === "youtube" ? "scheduled" : "published" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown publishing error";
      await updatePost(post.id, {
        status: "failed",
        last_error: message.slice(0, 2000),
        locked_at: null,
      });
      results.push({ id: post.id, status: "failed", error: message });
    }
  }
  return json({ checked_at: now.toISOString(), processed: results.length, results });
});
