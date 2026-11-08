import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { postId } = (await req.json()) as { postId?: string };
    if (!postId) {
      return NextResponse.json({ error: "postId is required" }, { status: 400 });
    }

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ error: "Supabase cloud credentials not configured in .env" }, { status: 500 });
    }

    const cleanUrl = url.replace(/\/$/, "");
    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };

    // 1. Fetch current post
    const fetchRes = await fetch(`${cleanUrl}/rest/v1/scheduled_posts?id=eq.${encodeURIComponent(postId)}`, {
      headers,
      cache: "no-store",
    });
    if (!fetchRes.ok) {
      return NextResponse.json({ error: "Failed to find scheduled post in Supabase" }, { status: 404 });
    }
    const posts = await fetchRes.json();
    if (!Array.isArray(posts) || posts.length === 0) {
      return NextResponse.json({ error: "Scheduled post not found" }, { status: 404 });
    }

    const post = posts[0];
    if (post.status !== "failed" && post.status !== "cancelled") {
      return NextResponse.json({ error: `Post is currently '${post.status}'. Only failed or cancelled posts can be retried.` }, { status: 400 });
    }

    // 2. Ensure scheduled_at is in future; if already passed, push it 10 minutes into the future
    let scheduledAt = new Date(post.scheduled_at);
    const minFuture = new Date(Date.now() + 5 * 60 * 1000);
    if (scheduledAt.getTime() < minFuture.getTime()) {
      scheduledAt = minFuture;
    }

    // 3. Reset status to queued
    const updateRes = await fetch(`${cleanUrl}/rest/v1/scheduled_posts?id=eq.${encodeURIComponent(postId)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        status: "queued",
        last_error: null,
        attempts: 0,
        locked_at: null,
        scheduled_at: scheduledAt.toISOString(),
      }),
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      return NextResponse.json({ error: `Could not retry post: ${errText}` }, { status: 500 });
    }

    const updated = await updateRes.json();
    return NextResponse.json({ success: true, post: updated[0] || post });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Retry request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
