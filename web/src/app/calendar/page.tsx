import Link from "next/link";

export const dynamic = "force-dynamic";

type ScheduledPost = {
  id: string;
  job_id: string;
  clip_id: string;
  platform: "youtube" | "instagram";
  scheduled_at: string;
  status: "queued" | "processing" | "scheduled" | "published" | "failed" | "cancelled";
  permalink: string | null;
  last_error: string | null;
  metadata: {
    youtube?: { title?: string };
    instagram?: { caption?: string };
  };
};

function displayTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function loadPosts(): Promise<{ posts: ScheduledPost[]; error?: string }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || process.env.CLOUD_PUBLISHING_ENABLED !== "true") {
    return { posts: [], error: "Enable cloud publishing and configure the server-side Supabase keys to view the cloud calendar." };
  }

  const response = await fetch(
    `${url.replace(/\/$/, "")}/rest/v1/scheduled_posts?select=id,job_id,clip_id,platform,scheduled_at,status,permalink,last_error,metadata&order=scheduled_at.asc&limit=200`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" },
  );
  if (!response.ok) return { posts: [], error: "Could not load the publishing calendar. Check Supabase configuration." };
  return { posts: await response.json() as ScheduledPost[] };
}

export default async function CalendarPage() {
  const { posts, error } = await loadPosts();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const postsByDay = new Map<number, ScheduledPost[]>();
  for (const post of posts) {
    const date = new Date(post.scheduled_at);
    if (date.getFullYear() !== year || date.getMonth() !== month) continue;
    const day = date.getDate();
    postsByDay.set(day, [...(postsByDay.get(day) || []), post]);
  }

  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-7 px-4 py-7 md:px-8 md:py-10">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs font-semibold text-muted">
        <Link href="/" className="transition hover:text-volt">Studio</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="text-ink">Calendar</span>
      </nav>

      <header className="flex flex-col justify-between gap-5 border-b border-white/10 pb-7 md:flex-row md:items-end">
        <div className="max-w-2xl">
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-ice">CHOP SHOP / DISTRIBUTION</p>
          <h1 className="display mt-3 text-5xl text-ink md:text-7xl">Publishing calendar<span className="text-volt">.</span></h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted md:text-base">
            Cloud-scheduled posts. Your laptop can be offline after the finished video upload completes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/library" className="inline-flex min-h-10 items-center rounded-lg border border-white/12 bg-panel px-4 py-2 text-xs font-bold text-ink transition hover:border-ice/50">
            Open library
          </Link>
          <span className="inline-flex min-h-10 items-center rounded-lg bg-volt px-4 py-2 text-xs font-extrabold text-[#080b10]">
            {now.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
          </span>
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-white/12 bg-panel p-5 text-sm text-muted">{error}</div>
      ) : (
        <>
          <section className="overflow-hidden rounded-xl border border-white/12 bg-panel">
            <div className="grid grid-cols-7 border-b border-white/10 bg-panel-raised">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div key={day} className="px-2 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-muted">{day}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((day, index) => {
                const dayPosts = day ? postsByDay.get(day) || [] : [];
                return (
                  <div key={index} className="min-h-28 border-b border-r border-white/8 p-2 md:min-h-36 md:p-3">
                    {day ? (
                      <>
                        <div className="mb-2 flex items-center justify-between">
                          <span className={day === now.getDate() ? "flex h-7 w-7 items-center justify-center rounded-full bg-volt text-xs font-black text-[#080b10]" : "text-xs font-bold text-ink"}>{day}</span>
                          {dayPosts.length > 0 ? <span className="text-[9px] font-bold text-muted">{dayPosts.length} POST{dayPosts.length === 1 ? "" : "S"}</span> : null}
                        </div>
                        <div className="flex flex-col gap-1">
                          {dayPosts.slice(0, 3).map((post) => (
                            <div key={post.id} className="rounded-md border border-white/10 bg-panel-raised px-2 py-1.5">
                              <div className="flex items-center justify-between gap-1">
                                <span className="truncate text-[9px] font-extrabold uppercase tracking-wide text-volt">{post.platform}</span>
                                <span className="text-[9px] text-muted">{new Date(post.scheduled_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-ink">
                                {post.metadata?.youtube?.title || post.metadata?.instagram?.caption || post.clip_id}
                              </p>
                              <span className="mt-1 inline-block text-[9px] uppercase tracking-wide text-muted">{post.status}</span>
                            </div>
                          ))}
                          {dayPosts.length > 3 ? <span className="text-[9px] text-muted">+{dayPosts.length - 3} more</span> : null}
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="display text-3xl text-ink">Upcoming queue</h2>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">{posts.length} saved posts</span>
            </div>
            {posts.length === 0 ? (
              <div className="rounded-xl border border-white/12 bg-panel p-6 text-sm text-muted">
                Nothing scheduled yet. Open a rendered clip in your library and use Schedule.
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-white/12 bg-panel">
                {posts.map((post) => (
                  <article key={post.id} className="grid gap-2 border-b border-white/8 p-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_180px_120px] md:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{post.metadata?.youtube?.title || post.metadata?.instagram?.caption || post.clip_id}</p>
                      <p className="mt-1 text-[10px] text-muted">{post.job_id} / {post.clip_id}</p>
                    </div>
                    <div className="text-xs text-muted">{displayTime(post.scheduled_at)}</div>
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide">
                      <span className="text-volt">{post.platform}</span>
                      <span className="text-muted">{post.status}</span>
                    </div>
                    {post.last_error ? <p className="text-xs text-red-300 md:col-span-3">{post.last_error}</p> : null}
                    {post.permalink ? <a href={post.permalink} target="_blank" rel="noreferrer" className="text-xs text-ice underline md:col-span-3">Open published post</a> : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
