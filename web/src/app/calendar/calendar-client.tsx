"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ScheduledPost } from "./page";

type ViewMode = "month" | "week" | "queue";
type PlatformFilter = "all" | "youtube" | "instagram";
type StatusFilter = "all" | ScheduledPost["status"];
type QueueSort = "asc" | "desc" | "failed_first";

const TZ = "Asia/Kolkata";
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const STATUS_STYLE: Record<
  ScheduledPost["status"],
  { label: string; dot: string; badge: string }
> = {
  published: {
    label: "PUBLISHED",
    dot: "bg-emerald-400",
    badge: "border-emerald-400/40 bg-emerald-950/60 text-emerald-300",
  },
  scheduled: {
    label: "SCHEDULED",
    dot: "bg-indigo-400",
    badge: "border-indigo-400/40 bg-indigo-950/60 text-indigo-300",
  },
  processing: {
    label: "PROCESSING",
    dot: "bg-cyan-400",
    badge: "border-cyan-400/40 bg-cyan-950/60 text-cyan-300",
  },
  queued: {
    label: "QUEUED",
    dot: "bg-amber-400",
    badge: "border-amber-400/40 bg-amber-950/60 text-amber-300",
  },
  failed: {
    label: "FAILED",
    dot: "bg-red-500",
    badge: "border-red-500/50 bg-red-950/70 text-red-300",
  },
  cancelled: {
    label: "CANCELLED",
    dot: "bg-white/30",
    badge: "border-white/15 bg-white/5 text-muted",
  },
};

function getISTParts(iso: string) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month) - 1,
    day: Number(map.day),
    time: `${map.hour === "24" ? "00" : map.hour}:${map.minute}`,
  };
}

function displayTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getPostTitle(post: ScheduledPost) {
  return (
    post.metadata?.youtube?.title ||
    post.metadata?.instagram?.caption ||
    post.clip_id
  );
}

export default function CalendarClient({
  posts,
  error,
  initialNowIso,
}: {
  posts: ScheduledPost[];
  error?: string;
  initialNowIso: string;
}) {
  const router = useRouter();
  const todayIST = useMemo(() => getISTParts(initialNowIso), [initialNowIso]);

  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [cursorYear, setCursorYear] = useState<number>(todayIST.year);
  const [cursorMonth, setCursorMonth] = useState<number>(todayIST.month);
  const [selectedDay, setSelectedDay] = useState<number>(todayIST.day);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [queueSort, setQueueSort] = useState<QueueSort>("asc");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard navigation ([ / ] month step, T today, 1/2/3 view switch, / search, Esc close inspector)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        if (e.key === "Escape") target.blur();
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "[") {
        stepMonth(-1);
      } else if (e.key === "]") {
        stepMonth(1);
      } else if (e.key === "t" || e.key === "T") {
        jumpToToday();
      } else if (e.key === "1") {
        setViewMode("month");
      } else if (e.key === "2") {
        setViewMode("week");
      } else if (e.key === "3") {
        setViewMode("queue");
      } else if (e.key === "Escape") {
        setSelectedPostId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function stepMonth(delta: number) {
    let nextMonth = cursorMonth + delta;
    let nextYear = cursorYear;
    if (nextMonth < 0) {
      nextMonth = 11;
      nextYear -= 1;
    } else if (nextMonth > 11) {
      nextMonth = 0;
      nextYear += 1;
    }
    setCursorMonth(nextMonth);
    setCursorYear(nextYear);
    setSelectedDay(1);
  }

  function jumpToToday() {
    setCursorYear(todayIST.year);
    setCursorMonth(todayIST.month);
    setSelectedDay(todayIST.day);
  }

  function handleRefresh() {
    setIsRefreshing(true);
    router.refresh();
    setTimeout(() => setIsRefreshing(false), 450);
  }

  function copyValue(key: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1400);
  }

  // Telemetry counts across all loaded posts
  const stats = useMemo(() => {
    const counts = {
      total: posts.length,
      scheduled: 0,
      processing: 0,
      published: 0,
      failed: 0,
    };
    for (const p of posts) {
      if (p.status === "scheduled" || p.status === "queued") counts.scheduled++;
      else if (p.status === "processing") counts.processing++;
      else if (p.status === "published") counts.published++;
      else if (p.status === "failed") counts.failed++;
    }
    return counts;
  }, [posts]);

  // Filtered posts
  const filteredPosts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return posts.filter((post) => {
      if (platformFilter !== "all" && post.platform !== platformFilter) {
        return false;
      }
      if (statusFilter !== "all" && post.status !== statusFilter) {
        return false;
      }
      if (q) {
        const title = getPostTitle(post).toLowerCase();
        const job = post.job_id.toLowerCase();
        const clip = post.clip_id.toLowerCase();
        return title.includes(q) || job.includes(q) || clip.includes(q);
      }
      return true;
    });
  }, [posts, platformFilter, statusFilter, searchQuery]);

  // Calendar Grid cells & day mapping for active month
  const { cells, postsByDay, daysInMonth } = useMemo(() => {
    const firstWeekday = new Date(cursorYear, cursorMonth, 1).getDay();
    const totalDays = new Date(cursorYear, cursorMonth + 1, 0).getDate();
    const gridCells: Array<number | null> = [
      ...Array.from({ length: firstWeekday }, () => null),
      ...Array.from({ length: totalDays }, (_, index) => index + 1),
    ];
    while (gridCells.length % 7 !== 0) gridCells.push(null);

    const map = new Map<number, ScheduledPost[]>();
    for (const post of filteredPosts) {
      const parts = getISTParts(post.scheduled_at);
      if (parts.year !== cursorYear || parts.month !== cursorMonth) continue;
      const existing = map.get(parts.day) || [];
      existing.push(post);
      map.set(parts.day, existing);
    }

    return { cells: gridCells, postsByDay: map, daysInMonth: totalDays };
  }, [filteredPosts, cursorYear, cursorMonth]);

  // Active week days around selectedDay
  const activeWeekDays = useMemo(() => {
    const clampedDay = Math.min(selectedDay, daysInMonth);
    const date = new Date(cursorYear, cursorMonth, clampedDay);
    const weekday = date.getDay();
    const startDay = clampedDay - weekday;
    return Array.from({ length: 7 }, (_, idx) => {
      const d = startDay + idx;
      return d >= 1 && d <= daysInMonth ? d : null;
    });
  }, [cursorYear, cursorMonth, selectedDay, daysInMonth]);

  // Sorted queue list
  const sortedQueue = useMemo(() => {
    const list = [...filteredPosts];
    list.sort((a, b) => {
      if (queueSort === "failed_first") {
        if (a.status === "failed" && b.status !== "failed") return -1;
        if (b.status === "failed" && a.status !== "failed") return 1;
      }
      const tA = new Date(a.scheduled_at).getTime();
      const tB = new Date(b.scheduled_at).getTime();
      return queueSort === "desc" ? tB - tA : tA - tB;
    });
    return list;
  }, [filteredPosts, queueSort]);

  const selectedDayPosts = useMemo(
    () => postsByDay.get(selectedDay) || [],
    [postsByDay, selectedDay],
  );

  const selectedPost = useMemo(
    () => posts.find((p) => p.id === selectedPostId) || null,
    [posts, selectedPostId],
  );

  return (
    <main className="calendar-workspace mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      {/* Top Breadcrumb + Telemetry Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 font-mono text-xs font-semibold text-muted"
        >
          <Link href="/" className="transition hover:text-volt">
            STUDIO
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page" className="text-ink">
            CALENDAR
          </span>
          <span className="ml-2 border border-white/12 bg-panel px-2 py-0.5 text-[10px] font-bold tracking-widest text-ice">
            IST (UTC+05:30)
          </span>
        </nav>

        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`border px-2.5 py-1 font-bold uppercase transition ${
              statusFilter === "all"
                ? "border-volt bg-volt text-[#080b10]"
                : "border-white/12 bg-panel text-ink hover:border-white/30"
            }`}
          >
            TOTAL: {stats.total}
          </button>
          <button
            type="button"
            onClick={() =>
              setStatusFilter(statusFilter === "scheduled" ? "all" : "scheduled")
            }
            className={`border px-2.5 py-1 font-bold uppercase transition ${
              statusFilter === "scheduled"
                ? "border-volt bg-volt text-[#080b10]"
                : "border-white/12 bg-panel text-volt hover:border-volt/50"
            }`}
          >
            SCHED: {stats.scheduled}
          </button>
          <button
            type="button"
            onClick={() =>
              setStatusFilter(statusFilter === "published" ? "all" : "published")
            }
            className={`border px-2.5 py-1 font-bold uppercase transition ${
              statusFilter === "published"
                ? "border-emerald-400 bg-emerald-400 text-[#080b10]"
                : "border-white/12 bg-panel text-emerald-300 hover:border-emerald-400/50"
            }`}
          >
            LIVE: {stats.published}
          </button>
          <button
            type="button"
            onClick={() =>
              setStatusFilter(statusFilter === "failed" ? "all" : "failed")
            }
            className={`border px-2.5 py-1 font-bold uppercase transition ${
              statusFilter === "failed"
                ? "border-red-500 bg-red-500 text-[#080b10]"
                : stats.failed > 0
                  ? "border-red-500/50 bg-red-950/60 text-red-300"
                  : "border-white/12 bg-panel text-muted"
            }`}
          >
            ERR: {stats.failed}
          </button>
        </div>
      </div>

      {/* Main Header */}
      <header className="calendar-heading flex flex-col justify-between gap-5 border-b border-white/10 pb-6 lg:flex-row lg:items-end">
        <div className="max-w-2xl">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-ice">
            CHOP SHOP / DISTRIBUTION PIPELINE
          </p>
          <h1 className="display mt-2 text-5xl tracking-tight text-ink md:text-7xl">
            Publishing calendar<span className="text-volt">.</span>
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
            Cloud-scheduled dispatch matrix. Your workstation can go offline once
            the rendered clip finishes uploading.
          </p>
        </div>

        {/* Navigation & Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center border border-white/12 bg-panel">
            <button
              type="button"
              onClick={() => stepMonth(-1)}
              title="Previous Month ([)"
              className="px-3 py-2 font-mono text-xs font-bold text-ink transition hover:bg-panel-raised hover:text-volt"
            >
              &larr;
            </button>
            <span className="min-w-[155px] border-x border-white/10 px-4 py-2 text-center font-mono text-xs font-extrabold uppercase tracking-wider text-ink">
              {MONTHS[cursorMonth]} {cursorYear}
            </span>
            <button
              type="button"
              onClick={() => stepMonth(1)}
              title="Next Month (])"
              className="px-3 py-2 font-mono text-xs font-bold text-ink transition hover:bg-panel-raised hover:text-volt"
            >
              &rarr;
            </button>
          </div>

          <button
            type="button"
            onClick={jumpToToday}
            title="Jump to Today (T)"
            className="min-h-9 border border-white/12 bg-panel px-3.5 py-2 font-mono text-xs font-bold uppercase text-ink transition hover:border-volt hover:text-volt"
          >
            Today
          </button>

          <button
            type="button"
            onClick={handleRefresh}
            className="min-h-9 border border-white/12 bg-panel px-3.5 py-2 font-mono text-xs font-bold uppercase text-ink transition hover:border-ice hover:text-ice"
          >
            {isRefreshing ? "Syncing..." : "Refresh"}
          </button>

          <Link
            href="/library"
            className="inline-flex min-h-9 items-center bg-volt px-4 py-2 font-mono text-xs font-extrabold uppercase tracking-wider text-[#080b10] transition hover:bg-white"
          >
            Open Library &rarr;
          </Link>
        </div>
      </header>

      {error ? (
        <div className="border-2 border-red-500/60 bg-panel p-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <p className="font-mono text-[10px] font-extrabold uppercase tracking-widest text-red-400">
                CLOUD_PUBLISHING_CONFIG_ERROR
              </p>
              <p className="mt-2 text-sm font-semibold text-ink">{error}</p>
              <p className="mt-1 font-mono text-xs text-muted">
                Verify SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and
                CLOUD_PUBLISHING_ENABLED=&quot;true&quot; in your environment.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              className="self-start border border-red-400/50 bg-red-950/50 px-4 py-2 font-mono text-xs font-bold uppercase text-red-200 transition hover:bg-red-900/60 md:self-center"
            >
              Retry Connection
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Command & Filter Bar */}
          <section className="calendar-controls flex flex-col justify-between gap-3 border border-white/12 bg-panel p-3 lg:flex-row lg:items-center">
            {/* View Mode Switcher */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex border border-white/12 bg-[#080b10] p-0.5 font-mono text-xs">
                {(
                  [
                    { id: "month", label: "1 // MONTH GRID" },
                    { id: "week", label: "2 // WEEK MATRIX" },
                    { id: "queue", label: "3 // QUEUE TABLE" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setViewMode(tab.id)}
                    className={`px-3 py-1.5 font-bold uppercase transition ${
                      viewMode === tab.id
                        ? "bg-volt text-[#080b10]"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Platform Filter */}
              <div className="inline-flex border border-white/12 bg-[#080b10] p-0.5 font-mono text-xs">
                {(["all", "youtube", "instagram"] as const).map((plat) => (
                  <button
                    key={plat}
                    type="button"
                    onClick={() => setPlatformFilter(plat)}
                    className={`px-2.5 py-1.5 font-bold uppercase transition ${
                      platformFilter === plat
                        ? "bg-panel-raised text-volt"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    {plat === "all" ? "ALL PLATFORMS" : plat}
                  </button>
                ))}
              </div>
            </div>

            {/* Search + Status Select */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 sm:w-64 sm:flex-initial">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter title, job_id, clip_id (Press /)"
                  className="w-full border border-white/12 bg-[#080b10] px-3 py-1.5 font-mono text-xs text-ink placeholder:text-muted focus:border-volt focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] font-bold text-muted hover:text-ink"
                  >
                    CLR
                  </button>
                )}
              </div>

              <select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as StatusFilter)
                }
                className="border border-white/12 bg-[#080b10] px-3 py-1.5 font-mono text-xs font-bold uppercase text-ink focus:border-volt focus:outline-none"
              >
                <option value="all">STATUS: ALL</option>
                <option value="scheduled">SCHEDULED</option>
                <option value="queued">QUEUED</option>
                <option value="processing">PROCESSING</option>
                <option value="published">PUBLISHED</option>
                <option value="failed">FAILED</option>
                <option value="cancelled">CANCELLED</option>
              </select>
            </div>
          </section>

          {/* Main Workspace + Right Inspector Split */}
          <div className="calendar-layout grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            {/* Primary Calendar or Queue View */}
            <div className="flex flex-col gap-6">
              {viewMode === "month" && (
                <section className="overflow-hidden border border-white/12 bg-panel">
                  <div className="grid grid-cols-7 border-b border-white/10 bg-panel-raised">
                    {WEEKDAYS.map((day) => (
                      <div
                        key={day}
                        className="border-r border-white/8 px-2 py-2.5 text-center font-mono text-[10px] font-bold uppercase tracking-widest text-muted last:border-r-0"
                      >
                        {day}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7">
                    {cells.map((day, index) => {
                      const dayPosts = day ? postsByDay.get(day) || [] : [];
                      const isToday =
                        day === todayIST.day &&
                        cursorMonth === todayIST.month &&
                        cursorYear === todayIST.year;
                      const isSelected = day !== null && day === selectedDay;
                      const hasFailed = dayPosts.some(
                        (p) => p.status === "failed",
                      );

                      return (
                        <div
                          key={index}
                          onClick={() => {
                            if (day) {
                              setSelectedDay(day);
                              setSelectedPostId(null);
                            }
                          }}
                          className={`min-h-32 border-b border-r border-white/8 p-2 transition md:min-h-40 md:p-2.5 ${
                            day
                              ? "cursor-pointer hover:bg-panel-raised/60"
                              : "bg-[#080b10]/60"
                          } ${
                            isSelected
                              ? "ring-2 ring-inset ring-volt bg-panel-raised/80"
                              : ""
                          }`}
                        >
                          {day ? (
                            <div className="flex h-full flex-col justify-between">
                              <div>
                                <div className="mb-2 flex items-center justify-between">
                                  <span
                                    className={
                                      isToday
                                        ? "flex h-6 w-6 items-center justify-center bg-volt font-mono text-xs font-black text-[#080b10]"
                                        : "font-mono text-xs font-bold text-ink"
                                    }
                                  >
                                    {String(day).padStart(2, "0")}
                                  </span>
                                  {dayPosts.length > 0 && (
                                    <span
                                      className={`px-1.5 py-0.5 font-mono text-[9px] font-extrabold uppercase ${
                                        hasFailed
                                          ? "bg-red-500/20 text-red-300"
                                          : "bg-white/5 text-muted"
                                      }`}
                                    >
                                      {dayPosts.length}{" "}
                                      {dayPosts.length === 1 ? "POST" : "POSTS"}
                                    </span>
                                  )}
                                </div>

                                <div className="flex flex-col gap-1.5">
                                  {dayPosts.slice(0, 3).map((post) => {
                                    const st = STATUS_STYLE[post.status];
                                    const isPostSelected =
                                      selectedPostId === post.id;
                                    return (
                                      <button
                                        key={post.id}
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedDay(day);
                                          setSelectedPostId(post.id);
                                        }}
                                        className={`w-full border px-2 py-1.5 text-left transition ${
                                          isPostSelected
                                            ? "border-volt bg-[#080b10]"
                                            : "border-white/10 bg-panel-raised hover:border-white/30"
                                        }`}
                                      >
                                        <div className="flex items-center justify-between gap-1 font-mono text-[9px]">
                                          <span
                                            className={`font-extrabold uppercase ${
                                              post.platform === "youtube"
                                                ? "text-volt"
                                                : "text-ice"
                                            }`}
                                          >
                                            {post.platform === "youtube"
                                              ? "YT"
                                              : "IG"}
                                          </span>
                                          <span className="text-muted">
                                            {getISTParts(post.scheduled_at).time}
                                          </span>
                                        </div>
                                        <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-ink">
                                          {getPostTitle(post)}
                                        </p>
                                        <div className="mt-1 flex items-center gap-1.5">
                                          <span
                                            className={`h-1.5 w-1.5 ${st.dot}`}
                                          />
                                          <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-muted">
                                            {st.label}
                                          </span>
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {dayPosts.length > 3 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedDay(day);
                                    setSelectedPostId(null);
                                  }}
                                  className="mt-1.5 w-full border border-volt/30 bg-volt/10 py-1 text-center font-mono text-[9px] font-extrabold uppercase tracking-wider text-volt transition hover:bg-volt hover:text-[#080b10]"
                                >
                                  +{dayPosts.length - 3} MORE // INSPECT DAY
                                </button>
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {viewMode === "week" && (
                <section className="overflow-hidden border border-white/12 bg-panel">
                  <div className="flex items-center justify-between border-b border-white/10 bg-panel-raised px-4 py-3">
                    <span className="font-mono text-xs font-bold uppercase tracking-wider text-ink">
                      7-DAY DISPATCH MATRIX // WEEK OF {MONTHS[cursorMonth].toUpperCase()}{" "}
                      {selectedDay}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedDay(Math.max(1, selectedDay - 7))
                        }
                        className="border border-white/12 bg-panel px-2.5 py-1 font-mono text-xs font-bold text-ink hover:border-volt"
                      >
                        &larr; PREV WK
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedDay(Math.min(daysInMonth, selectedDay + 7))
                        }
                        className="border border-white/12 bg-panel px-2.5 py-1 font-mono text-xs font-bold text-ink hover:border-volt"
                      >
                        NEXT WK &rarr;
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 divide-y divide-white/10 md:grid-cols-7 md:divide-x md:divide-y-0">
                    {activeWeekDays.map((day, idx) => {
                      const dayPosts = day ? postsByDay.get(day) || [] : [];
                      const isSelected = day !== null && day === selectedDay;
                      return (
                        <div
                          key={idx}
                          onClick={() => day && setSelectedDay(day)}
                          className={`min-h-[340px] p-3 ${
                            isSelected ? "bg-panel-raised/70" : ""
                          }`}
                        >
                          <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-2">
                            <span className="font-mono text-[10px] font-bold text-muted">
                              {WEEKDAYS[idx]}
                            </span>
                            <span
                              className={`font-mono text-xs font-extrabold ${
                                isSelected ? "text-volt" : "text-ink"
                              }`}
                            >
                              {day ? String(day).padStart(2, "0") : "--"}
                            </span>
                          </div>
                          <div className="flex flex-col gap-2">
                            {dayPosts.map((post) => {
                              const st = STATUS_STYLE[post.status];
                              return (
                                <button
                                  key={post.id}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (day) setSelectedDay(day);
                                    setSelectedPostId(post.id);
                                  }}
                                  className="border border-white/12 bg-panel-raised p-2 text-left transition hover:border-volt"
                                >
                                  <div className="flex items-center justify-between font-mono text-[9px]">
                                    <span className="font-extrabold uppercase text-volt">
                                      {post.platform}
                                    </span>
                                    <span className="text-muted">
                                      {getISTParts(post.scheduled_at).time}
                                    </span>
                                  </div>
                                  <p className="mt-1 line-clamp-2 text-xs font-semibold text-ink">
                                    {getPostTitle(post)}
                                  </p>
                                  <span
                                    className={`mt-2 inline-block border px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase ${st.badge}`}
                                  >
                                    {st.label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Upcoming Queue Table (Always accessible in Queue mode or below calendar) */}
              <section className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <h2 className="display text-2xl text-ink md:text-3xl">
                      Upcoming queue
                    </h2>
                    <span className="border border-white/12 bg-panel px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-muted">
                      {sortedQueue.length} SHOWN
                    </span>
                  </div>

                  <div className="flex items-center gap-1 font-mono text-[10px]">
                    <span className="mr-1 text-muted">SORT:</span>
                    {(
                      [
                        { id: "asc", label: "TIME ASC" },
                        { id: "desc", label: "TIME DESC" },
                        { id: "failed_first", label: "ERRORS FIRST" },
                      ] as const
                    ).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setQueueSort(s.id)}
                        className={`border px-2 py-1 font-bold uppercase transition ${
                          queueSort === s.id
                            ? "border-volt bg-volt text-[#080b10]"
                            : "border-white/12 bg-panel text-muted hover:text-ink"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {sortedQueue.length === 0 ? (
                  <div className="border border-white/12 bg-panel p-6 text-sm text-muted">
                    No matching scheduled posts. Open a rendered clip in your{" "}
                    <Link href="/library" className="text-volt underline">
                      library
                    </Link>{" "}
                    and use Schedule, or clear active filters.
                  </div>
                ) : (
                  <div className="overflow-hidden border border-white/12 bg-panel">
                    {sortedQueue.map((post) => {
                      const st = STATUS_STYLE[post.status];
                      const isSelected = selectedPostId === post.id;
                      return (
                        <article
                          key={post.id}
                          onClick={() => {
                            const parts = getISTParts(post.scheduled_at);
                            setCursorYear(parts.year);
                            setCursorMonth(parts.month);
                            setSelectedDay(parts.day);
                            setSelectedPostId(post.id);
                          }}
                          className={`grid cursor-pointer gap-3 border-b border-white/8 p-4 transition last:border-b-0 md:grid-cols-[minmax(0,1fr)_190px_160px] md:items-center ${
                            isSelected
                              ? "bg-panel-raised ring-1 ring-inset ring-volt"
                              : "hover:bg-panel-raised/60"
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={`font-mono text-[10px] font-extrabold uppercase ${
                                  post.platform === "youtube"
                                    ? "text-volt"
                                    : "text-ice"
                                }`}
                              >
                                [{post.platform}]
                              </span>
                              <p className="truncate text-sm font-bold text-ink">
                                {getPostTitle(post)}
                              </p>
                            </div>
                            <p className="mt-1 font-mono text-[11px] text-muted">
                              JOB: {post.job_id} / CLIP: {post.clip_id}
                            </p>
                          </div>

                          <div className="font-mono text-xs text-muted">
                            {displayTime(post.scheduled_at)}
                          </div>

                          <div className="flex items-center justify-start gap-2 md:justify-end">
                            <span
                              className={`border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${st.badge}`}
                            >
                              {st.label}
                            </span>
                          </div>

                          {post.last_error ? (
                            <p className="border-l-2 border-red-500 bg-red-950/40 px-3 py-1.5 font-mono text-xs text-red-300 md:col-span-3">
                              ERR: {post.last_error}
                            </p>
                          ) : null}

                          {post.permalink ? (
                            <div className="md:col-span-3">
                              <a
                                href={post.permalink}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-block font-mono text-xs font-bold text-ice underline hover:text-volt"
                              >
                                OPEN PUBLISHED PERMALINK &nearr;
                              </a>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            {/* Right Docked Inspector Drawer (Solves the +N more overflow & metadata inspection) */}
            <aside className="flex flex-col border border-white/12 bg-panel xl:sticky xl:top-6 xl:h-[calc(100vh-3rem)]">
              <div className="flex items-center justify-between border-b border-white/10 bg-panel-raised px-4 py-3">
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-ice">
                    {selectedPost ? "POST TELEMETRY" : "DAILY MANIFEST"}
                  </p>
                  <h3 className="font-mono text-sm font-extrabold uppercase text-ink">
                    {selectedPost
                      ? `ID // ${selectedPost.id.slice(0, 12)}`
                      : `${ String(selectedDay).padStart(2, "0")} ${MONTHS[cursorMonth]} ${cursorYear}`}
                  </h3>
                </div>
                {selectedPost && (
                  <button
                    type="button"
                    onClick={() => setSelectedPostId(null)}
                    className="border border-white/15 bg-panel px-2.5 py-1 font-mono text-[10px] font-bold uppercase text-ink hover:border-volt hover:text-volt"
                  >
                    &larr; DAY LIST
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {selectedPost ? (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between border-b border-white/10 pb-3">
                      <span
                        className={`font-mono text-xs font-extrabold uppercase ${
                          selectedPost.platform === "youtube"
                            ? "text-volt"
                            : "text-ice"
                        }`}
                      >
                        PLATFORM // {selectedPost.platform}
                      </span>
                      <span
                        className={`border px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                          STATUS_STYLE[selectedPost.status].badge
                        }`}
                      >
                        {STATUS_STYLE[selectedPost.status].label}
                      </span>
                    </div>

                    <div>
                      <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                        SCHEDULED AT (IST)
                      </p>
                      <p className="mt-1 font-mono text-sm font-bold text-ink">
                        {displayTime(selectedPost.scheduled_at)}
                      </p>
                    </div>

                    <div>
                      <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                        {selectedPost.platform === "youtube"
                          ? "YOUTUBE TITLE"
                          : "INSTAGRAM CAPTION"}
                      </p>
                      <div className="mt-1.5 border border-white/10 bg-[#080b10] p-3 text-xs leading-relaxed text-ink">
                        {getPostTitle(selectedPost)}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                      <div className="flex items-center justify-between border border-white/10 bg-[#080b10] px-3 py-2">
                        <div className="min-w-0">
                          <p className="font-mono text-[9px] uppercase text-muted">
                            JOB_ID
                          </p>
                          <p className="truncate font-mono text-xs font-bold text-ink">
                            {selectedPost.job_id}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            copyValue("job", selectedPost.job_id)
                          }
                          className="border border-white/15 px-2 py-1 font-mono text-[10px] font-bold uppercase text-volt hover:bg-volt hover:text-[#080b10]"
                        >
                          {copiedKey === "job" ? "COPIED" : "COPY"}
                        </button>
                      </div>

                      <div className="flex items-center justify-between border border-white/10 bg-[#080b10] px-3 py-2">
                        <div className="min-w-0">
                          <p className="font-mono text-[9px] uppercase text-muted">
                            CLIP_ID
                          </p>
                          <p className="truncate font-mono text-xs font-bold text-ink">
                            {selectedPost.clip_id}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            copyValue("clip", selectedPost.clip_id)
                          }
                          className="border border-white/15 px-2 py-1 font-mono text-[10px] font-bold uppercase text-volt hover:bg-volt hover:text-[#080b10]"
                        >
                          {copiedKey === "clip" ? "COPIED" : "COPY"}
                        </button>
                      </div>
                    </div>

                    {selectedPost.last_error && (
                      <div className="border border-red-500/50 bg-red-950/50 p-3">
                        <p className="font-mono text-[10px] font-extrabold uppercase text-red-300">
                          LAST PIPELINE ERROR
                        </p>
                        <p className="mt-1 font-mono text-xs text-red-200">
                          {selectedPost.last_error}
                        </p>
                      </div>
                    )}

                    {selectedPost.permalink && (
                      <a
                        href={selectedPost.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="block w-full bg-ice py-2.5 text-center font-mono text-xs font-extrabold uppercase text-[#080b10] transition hover:bg-volt"
                      >
                        OPEN PUBLISHED POST &nearr;
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center justify-between border-b border-white/10 pb-2">
                      <span className="font-mono text-[11px] font-bold text-muted">
                        {selectedDayPosts.length} SCHEDULED{" "}
                        {selectedDayPosts.length === 1 ? "ITEM" : "ITEMS"}
                      </span>
                      <Link
                        href="/library"
                        className="font-mono text-[11px] font-bold text-volt hover:underline"
                      >
                        + SCHEDULE CLIP
                      </Link>
                    </div>

                    {selectedDayPosts.length === 0 ? (
                      <div className="border border-dashed border-white/12 p-6 text-center font-mono text-xs text-muted">
                        NO DISPATCHES SCHEDULED FOR THIS DATE.
                      </div>
                    ) : (
                      selectedDayPosts.map((post) => {
                        const st = STATUS_STYLE[post.status];
                        return (
                          <button
                            key={post.id}
                            type="button"
                            onClick={() => setSelectedPostId(post.id)}
                            className="w-full border border-white/12 bg-panel-raised p-3 text-left transition hover:border-volt"
                          >
                            <div className="flex items-center justify-between font-mono text-[10px]">
                              <span
                                className={`font-extrabold uppercase ${
                                  post.platform === "youtube"
                                    ? "text-volt"
                                    : "text-ice"
                                }`}
                              >
                                {post.platform} {"//"}{" "}
                                {getISTParts(post.scheduled_at).time} IST
                              </span>
                              <span
                                className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${st.badge}`}
                              >
                                {st.label}
                              </span>
                            </div>
                            <p className="mt-1.5 line-clamp-2 text-xs font-bold text-ink">
                              {getPostTitle(post)}
                            </p>
                            <p className="mt-1 font-mono text-[10px] text-muted">
                              {post.job_id} / {post.clip_id}
                            </p>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-white/10 bg-panel-raised px-4 py-2.5 font-mono text-[10px] text-muted">
                HOTKEYS: <span className="text-ink">[ ]</span> MONTH &middot;{" "}
                <span className="text-ink">T</span> TODAY &middot;{" "}
                <span className="text-ink">1/2/3</span> VIEW &middot;{" "}
                <span className="text-ink">/</span> SEARCH
              </div>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
