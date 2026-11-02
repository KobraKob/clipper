import { Bricolage_Grotesque, Figtree } from "next/font/google";
import CalendarClient from "./calendar-client";
import "./calendar.css";

export const dynamic = "force-dynamic";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});
const body = Figtree({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

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
        "Cloud publishing isn't set up. Enable it and add the server-side Supabase keys to see your calendar.",
    };
  }

  // Newest 500 first, so recent and upcoming posts never fall off the end.
  // The client sorts and groups them.
  const endpoint =
    `${url.replace(/\/$/, "")}/rest/v1/scheduled_posts` +
    `?select=id,job_id,clip_id,platform,scheduled_at,status,permalink,last_error,metadata` +
    `&order=scheduled_at.desc&limit=500`;

  try {
    const response = await fetch(endpoint, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        posts: [],
        error: `The calendar couldn't load (Supabase returned ${response.status}). Check your configuration and try again.`,
      };
    }

    return { posts: (await response.json()) as ScheduledPost[] };
  } catch {
    return {
      posts: [],
      error: "The calendar couldn't reach Supabase. Check your connection and try again.",
    };
  }
}

export default async function CalendarPage() {
  const { posts, error } = await loadPosts();

  return (
    <div className={`cal ${display.variable} ${body.variable}`}>
      <CalendarClient
        posts={posts}
        error={error}
        initialNowIso={new Date().toISOString()}
      />
    </div>
  );
}