import CalendarClient from "./calendar-client";
import { CalendarScheduler } from "@/components/CalendarScheduler";

export const dynamic = "force-dynamic";

export type ScheduledPost = {
  id: string;
  job_id: string;
  clip_id: string;
  platform: "youtube" | "instagram";
  scheduled_at: string;
  status:
    | "queued"
    | "processing"
    | "scheduled"
    | "published"
    | "failed"
    | "cancelled";
  permalink: string | null;
  last_error: string | null;
  metadata: {
    youtube?: { title?: string };
    instagram?: { caption?: string };
  };
};

async function loadPosts(): Promise<{ posts: ScheduledPost[]; error?: string }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key || process.env.CLOUD_PUBLISHING_ENABLED !== "true") {
    return {
      posts: [],
      error:
        "Enable cloud publishing and configure the server-side Supabase keys to view the cloud calendar.",
    };
  }

  const response = await fetch(
    `${url.replace(/\/$/, "")}/rest/v1/scheduled_posts?select=id,job_id,clip_id,platform,scheduled_at,status,permalink,last_error,metadata&order=scheduled_at.asc&limit=200`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    return {
      posts: [],
      error: "Could not load the publishing calendar. Check Supabase configuration.",
    };
  }

  return {
    posts: (await response.json()) as ScheduledPost[],
  };
}

export default async function CalendarPage() {
  const { posts, error } = await loadPosts();

  return (
    <>
      <CalendarScheduler />
      <CalendarClient
        posts={posts}
        error={error}
        initialNowIso={new Date().toISOString()}
      />
    </>
  );
}
