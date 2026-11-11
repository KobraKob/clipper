"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Divider } from "@astryxdesign/core/Divider";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { Kbd } from "@astryxdesign/core/Kbd";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Table, pixel, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { ArrowRightGlyph, FilmGlyph, RefreshGlyph } from "@/components/StudioIcons";

export type ScheduledPost = {
  id: string;
  job_id: string;
  clip_id: string;
  platform: "youtube" | "instagram";
  scheduled_at: string;
  status: "scheduled" | "queued" | "processing" | "published" | "failed" | "cancelled";
  attempts?: number;
  last_error?: string | null;
  permalink?: string | null;
  metadata?: {
    youtube?: { title?: string; description?: string; privacy?: string };
    instagram?: { caption?: string };
  };
};

type ViewMode = "month" | "week" | "queue";
type PlatformFilter = "all" | "youtube" | "instagram";
type StatusFilter = "all" | ScheduledPost["status"];
type QueueSort = "asc" | "desc" | "failed_first";

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
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const STATUS_META: Record<
  ScheduledPost["status"],
  {
    label: string;
    badge: "info" | "warning" | "success" | "error" | "neutral";
    dot: "warning" | "success" | "error" | "neutral";
  }
> = {
  scheduled: { label: "Scheduled", badge: "info", dot: "warning" },
  queued: { label: "Queued", badge: "warning", dot: "warning" },
  processing: { label: "Uploading", badge: "warning", dot: "warning" },
  published: { label: "Published", badge: "success", dot: "success" },
  failed: { label: "Failed", badge: "error", dot: "error" },
  cancelled: { label: "Cancelled", badge: "neutral", dot: "neutral" },
};

function getISTParts(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return { year: 1970, month: 0, day: 1, time: "00:00" };
  }
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value || "0";
  return {
    year: Number(pick("year")),
    month: Math.max(0, Number(pick("month")) - 1),
    day: Number(pick("day")),
    time: `${pick("hour")}:${pick("minute")}`,
  };
}

function displayTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return (
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date) + " IST"
  );
}

function getPostTitle(post: ScheduledPost): string {
  return (
    post.metadata?.youtube?.title ||
    post.metadata?.instagram?.caption ||
    post.clip_id
  );
}

type QueueRow = ScheduledPost & Record<string, unknown>;

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
  const toast = useToast();
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [optimisticOverrides, setOptimisticOverrides] = useState<
    Record<string, Partial<ScheduledPost>>
  >({});

  const searchInputRef = useRef<HTMLInputElement>(null);

  const allPosts = useMemo(
    () =>
      posts.map((p) =>
        optimisticOverrides[p.id] ? { ...p, ...optimisticOverrides[p.id] } : p,
      ),
    [posts, optimisticOverrides],
  );

  const stepMonth = useCallback(
    (delta: number) => {
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
    },
    [cursorMonth, cursorYear],
  );

  const jumpToToday = useCallback(() => {
    setCursorYear(todayIST.year);
    setCursorMonth(todayIST.month);
    setSelectedDay(todayIST.day);
  }, [todayIST]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "[") {
        stepMonth(-1);
      } else if (e.key === "]") {
        stepMonth(1);
      } else if (e.key.toLowerCase() === "t") {
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
  }, [stepMonth, jumpToToday]);

  async function handleRetry(postId: string) {
    setRetryingId(postId);
    try {
      const res = await fetch("/api/calendar/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast({ body: data.error || "Retry failed", type: "error", uniqueID: "cal-retry-err" });
        return;
      }
      setOptimisticOverrides((prev) => ({
        ...prev,
        [postId]: { status: "queued", last_error: null, attempts: 0 },
      }));
      toast({ body: "Post re-queued for publishing.", uniqueID: "cal-retry-ok" });
      router.refresh();
    } catch {
      toast({ body: "Network error while retrying post.", type: "error", uniqueID: "cal-retry-net" });
    } finally {
      setRetryingId(null);
    }
  }

  function handleRefresh() {
    setIsRefreshing(true);
    router.refresh();
    window.setTimeout(() => setIsRefreshing(false), 500);
  }

  async function copyValue(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ body: `${label} copied.`, uniqueID: `cal-copy-${label}` });
    } catch {
      toast({ body: "Clipboard access denied.", type: "error", uniqueID: "cal-copy-err" });
    }
  }

  const stats = useMemo(() => {
    const counts = { total: allPosts.length, scheduled: 0, processing: 0, published: 0, failed: 0 };
    for (const p of allPosts) {
      if (p.status === "scheduled" || p.status === "queued") counts.scheduled += 1;
      else if (p.status === "processing") counts.processing += 1;
      else if (p.status === "published") counts.published += 1;
      else if (p.status === "failed") counts.failed += 1;
    }
    return counts;
  }, [allPosts]);

  const filteredPosts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allPosts.filter((post) => {
      if (platformFilter !== "all" && post.platform !== platformFilter) return false;
      if (statusFilter !== "all" && post.status !== statusFilter) return false;
      if (q) {
        const title = getPostTitle(post).toLowerCase();
        return (
          title.includes(q) ||
          post.job_id.toLowerCase().includes(q) ||
          post.clip_id.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allPosts, platformFilter, statusFilter, searchQuery]);

  const { cells, postsByDay, daysInMonth } = useMemo(() => {
    const firstWeekday = new Date(cursorYear, cursorMonth, 1).getDay();
    const totalDays = new Date(cursorYear, cursorMonth + 1, 0).getDate();
    const gridCells: Array<number | null> = [
      ...Array.from({ length: firstWeekday }, () => null),
      ...Array.from({ length: totalDays }, (_, i) => i + 1),
    ];
    while (gridCells.length % 7 !== 0) gridCells.push(null);

    const map = new Map<number, ScheduledPost[]>();
    for (const post of filteredPosts) {
      const parts = getISTParts(post.scheduled_at);
      if (parts.year !== cursorYear || parts.month !== cursorMonth) continue;
      const list = map.get(parts.day) ?? [];
      list.push(post);
      map.set(parts.day, list);
    }
    return { cells: gridCells, postsByDay: map, daysInMonth: totalDays };
  }, [filteredPosts, cursorYear, cursorMonth]);

  const activeWeekDays = useMemo(() => {
    const firstWeekday = new Date(cursorYear, cursorMonth, 1).getDay();
    const weekOffset = Math.floor((firstWeekday + selectedDay - 1) / 7) * 7;
    return cells.slice(weekOffset, weekOffset + 7);
  }, [cells, cursorYear, cursorMonth, selectedDay]);

  const sortedQueue = useMemo(() => {
    const copy = [...filteredPosts];
    if (queueSort === "asc") {
      copy.sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
    } else if (queueSort === "desc") {
      copy.sort((a, b) => Date.parse(b.scheduled_at) - Date.parse(a.scheduled_at));
    } else {
      copy.sort((a, b) => {
        if (a.status === "failed" && b.status !== "failed") return -1;
        if (b.status === "failed" && a.status !== "failed") return 1;
        return Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at);
      });
    }
    return copy;
  }, [filteredPosts, queueSort]);

  const selectedDayPosts = useMemo(
    () => postsByDay.get(selectedDay) ?? [],
    [postsByDay, selectedDay],
  );

  const selectedPost = useMemo(
    () => (selectedPostId ? allPosts.find((p) => p.id === selectedPostId) ?? null : null),
    [allPosts, selectedPostId],
  );

  const queueColumns: TableColumn<QueueRow>[] = [
    {
      key: "title",
      header: "Post",
      width: proportional(2, { minWidth: 200 }),
      renderCell: (post) => (
        <VStack gap={0.5}>
          <Text type="body" weight="semibold" maxLines={1}>
            {getPostTitle(post)}
          </Text>
          <Text type="code" color="secondary">
            {post.platform.toUpperCase()} · {post.clip_id}
          </Text>
        </VStack>
      ),
    },
    {
      key: "scheduled",
      header: "Scheduled (IST)",
      width: pixel(180),
      renderCell: (post) => (
        <Text type="supporting" hasTabularNumbers>
          {displayTime(post.scheduled_at)}
        </Text>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: pixel(120),
      renderCell: (post) => {
        const meta = STATUS_META[post.status];
        return (
          <HStack gap={1.5} align="center">
            <StatusDot
              variant={meta.dot}
              label={meta.label}
              isPulsing={post.status === "processing"}
            />
            <Badge label={meta.label} variant={meta.badge} />
          </HStack>
        );
      },
    },
    {
      key: "inspect",
      header: "Action",
      width: pixel(120),
      renderCell: (post) => (
        <Button
          label="Inspect"
          variant={selectedPostId === post.id ? "primary" : "secondary"}
          size="sm"
          onClick={() => {
            const parts = getISTParts(post.scheduled_at);
            setCursorYear(parts.year);
            setCursorMonth(parts.month);
            setSelectedDay(parts.day);
            setSelectedPostId(post.id);
          }}
        />
      ),
    },
  ];

  if (error) {
    return (
      <Banner
        status="error"
        title="Cloud publishing configuration error"
        description={`${error} Verify SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and CLOUD_PUBLISHING_ENABLED="true".`}
        endContent={
          <Button
            label="Retry connection"
            variant="secondary"
            size="sm"
            onClick={handleRefresh}
          />
        }
      />
    );
  }

  return (
    <VStack gap={6}>
      {/* Telemetry KPI Strip */}
      <Grid columns={{ minWidth: 160, max: 4 }} gap={3}>
        <Card padding={4} variant="muted">
          <VStack gap={1}>
            <Text type="label" color="secondary">
              SCHEDULED / QUEUED
            </Text>
            <Text type="display-3" hasTabularNumbers>
              {stats.scheduled}
            </Text>
          </VStack>
        </Card>
        <Card padding={4} variant="muted">
          <VStack gap={1}>
            <Text type="label" color="secondary">
              PROCESSING
            </Text>
            <Text type="display-3" hasTabularNumbers>
              {stats.processing}
            </Text>
          </VStack>
        </Card>
        <Card padding={4} variant="muted">
          <VStack gap={1}>
            <Text type="label" color="secondary">
              PUBLISHED
            </Text>
            <Text type="display-3" hasTabularNumbers>
              {stats.published}
            </Text>
          </VStack>
        </Card>
        <Card padding={4} variant="muted">
          <VStack gap={1}>
            <HStack gap={1.5} align="center">
              {stats.failed > 0 ? <StatusDot variant="error" label="Failed dispatches" /> : null}
              <Text type="label" color="secondary">
                FAILED
              </Text>
            </HStack>
            <Text
              type="display-3"
              hasTabularNumbers
              color={stats.failed > 0 ? "accent" : "inherit"}
            >
              {stats.failed}
            </Text>
          </VStack>
        </Card>
      </Grid>

      {/* Command & Filter Bar */}
      <Card padding={4} variant="default">
        <VStack gap={4}>
          <HStack justify="between" align="center" wrap="wrap" gap={3}>
            <HStack gap={2} align="center" wrap="wrap">
              <Button label="←" variant="secondary" size="sm" onClick={() => stepMonth(-1)} />
              <Heading level={2} type="display-3">
                {MONTHS[cursorMonth]} {cursorYear}
              </Heading>
              <Button label="→" variant="secondary" size="sm" onClick={() => stepMonth(1)} />
              <Button label="Today" variant="ghost" size="sm" onClick={jumpToToday} />
            </HStack>

            <HStack gap={2} align="center" wrap="wrap">
              <Button
                label={isRefreshing ? "Syncing…" : "Refresh"}
                variant="secondary"
                size="sm"
                isLoading={isRefreshing}
                icon={<Icon icon={RefreshGlyph} />}
                onClick={handleRefresh}
              />
              <Button
                label="Open library"
                href="/library"
                variant="secondary"
                size="sm"
                endContent={<Icon icon={ArrowRightGlyph} size="sm" />}
              />
            </HStack>
          </HStack>

          <Divider />

          <Grid columns={{ minWidth: 220, max: 4 }} gap={3} align="end">
            <SegmentedControl
              label="Calendar view"
              value={viewMode}
              onChange={(v) => setViewMode(v as ViewMode)}
              layout="fill"
            >
              <SegmentedControlItem value="month" label="Month" />
              <SegmentedControlItem value="week" label="Week" />
              <SegmentedControlItem value="queue" label="Queue" />
            </SegmentedControl>

            <SegmentedControl
              label="Platform"
              value={platformFilter}
              onChange={(v) => setPlatformFilter(v as PlatformFilter)}
              layout="fill"
            >
              <SegmentedControlItem value="all" label="All" />
              <SegmentedControlItem value="youtube" label="YouTube" />
              <SegmentedControlItem value="instagram" label="Instagram" />
            </SegmentedControl>

            <Selector
              label="Status"
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as StatusFilter)}
              options={[
                { value: "all", label: "All statuses" },
                { value: "scheduled", label: "Scheduled" },
                { value: "queued", label: "Queued" },
                { value: "processing", label: "Uploading" },
                { value: "published", label: "Published" },
                { value: "failed", label: "Failed" },
                { value: "cancelled", label: "Cancelled" },
              ]}
              width="100%"
            />

            <TextInput
              ref={searchInputRef}
              type="search"
              label="Search posts"
              placeholder="Title, job ID, clip ID… (/)"
              value={searchQuery}
              onChange={setSearchQuery}
              hasClear
              width="100%"
            />
          </Grid>
        </VStack>
      </Card>

      {/* Main Split: Calendar/Queue + Inspector */}
      <HStack gap={6} align="start" wrap="wrap">
        <VStack gap={6} className="min-w-0 flex-[2_1_580px]">
            {viewMode === "month" ? (
              <Card padding={4} variant="default">
                <VStack className="overflow-x-auto">
                <VStack gap={3} className="min-w-[600px]">
                  <Grid columns={7} gap={1.5}>
                    {WEEKDAYS.map((wd) => (
                      <Text key={wd} type="label" color="secondary" className="text-center">
                        {wd}
                      </Text>
                    ))}
                  </Grid>

                  <Grid columns={7} gap={1.5}>
                    {cells.map((day, index) => {
                      if (!day) {
                        return <Card key={`empty-${index}`} padding={2} variant="muted" height={96} />;
                      }
                      const dayPosts = postsByDay.get(day) ?? [];
                      const isToday =
                        day === todayIST.day &&
                        cursorMonth === todayIST.month &&
                        cursorYear === todayIST.year;
                      const isSelected = day === selectedDay;
                      const hasFailed = dayPosts.some((p) => p.status === "failed");

                      return (
                        <ClickableCard
                          key={`day-${day}`}
                          label={`${MONTHS[cursorMonth]} ${day}`}
                          onClick={() => {
                            setSelectedDay(day);
                            setSelectedPostId(null);
                          }}
                          variant={isSelected ? "default" : "muted"}
                          padding={2}
                          height={96}
                        >
                          <VStack gap={1.5} height="100%" justify="between">
                            <HStack justify="between" align="center">
                              <Text
                                type="code"
                                weight="bold"
                                color={isToday ? "accent" : "inherit"}
                              >
                                {String(day).padStart(2, "0")}
                              </Text>
                              {hasFailed ? (
                                <StatusDot variant="error" label="Failed dispatch" />
                              ) : dayPosts.length > 0 ? (
                                <Badge label={dayPosts.length} variant="info" />
                              ) : null}
                            </HStack>

                            {dayPosts.slice(0, 2).map((p) => (
                              <Text key={p.id} type="supporting" maxLines={1}>
                                {getISTParts(p.scheduled_at).time} · {getPostTitle(p)}
                              </Text>
                            ))}

                            {dayPosts.length > 2 ? (
                              <Text type="code" color="accent">
                                +{dayPosts.length - 2} more
                              </Text>
                            ) : null}
                          </VStack>
                        </ClickableCard>
                      );
                    })}
                  </Grid>
                </VStack>
                </VStack>
              </Card>
            ) : null}

            {viewMode === "week" ? (
              <Card padding={4} variant="default">
                <VStack gap={4}>
                  <HStack justify="between" align="center" wrap="wrap" gap={2}>
                    <Text type="label" color="accent">
                      WEEK OF {MONTHS[cursorMonth].toUpperCase()} {selectedDay}
                    </Text>
                    <HStack gap={2}>
                      <Button
                        label="← Prev week"
                        variant="secondary"
                        size="sm"
                        onClick={() => setSelectedDay(Math.max(1, selectedDay - 7))}
                      />
                      <Button
                        label="Next week →"
                        variant="secondary"
                        size="sm"
                        onClick={() => setSelectedDay(Math.min(daysInMonth, selectedDay + 7))}
                      />
                    </HStack>
                  </HStack>

                  <Grid columns={{ minWidth: 140, max: 7 }} gap={2}>
                    {activeWeekDays.map((day, idx) => {
                      const dayPosts = day ? postsByDay.get(day) ?? [] : [];
                      const isSelected = day !== null && day === selectedDay;
                      return (
                        <Card
                          key={idx}
                          padding={3}
                          variant={isSelected ? "default" : "muted"}
                        >
                          <VStack gap={2}>
                            <HStack justify="between" align="center">
                              <Text type="label" color="secondary">
                                {WEEKDAYS[idx]}
                              </Text>
                              <Text type="code" color={isSelected ? "accent" : "inherit"}>
                                {day ? String(day).padStart(2, "0") : "--"}
                              </Text>
                            </HStack>
                            {dayPosts.length === 0 ? (
                              <Text type="supporting" color="secondary">
                                Empty
                              </Text>
                            ) : (
                              dayPosts.map((post) => (
                                <ClickableCard
                                  key={post.id}
                                  label={getPostTitle(post)}
                                  onClick={() => {
                                    if (day) setSelectedDay(day);
                                    setSelectedPostId(post.id);
                                  }}
                                  padding={2}
                                  variant="default"
                                >
                                  <VStack gap={1}>
                                    <HStack justify="between" align="center">
                                      <Badge label={post.platform} variant="info" />
                                      <Text type="code" color="secondary">
                                        {getISTParts(post.scheduled_at).time}
                                      </Text>
                                    </HStack>
                                    <Text type="supporting" maxLines={2}>
                                      {getPostTitle(post)}
                                    </Text>
                                  </VStack>
                                </ClickableCard>
                              ))
                            )}
                          </VStack>
                        </Card>
                      );
                    })}
                  </Grid>
                </VStack>
              </Card>
            ) : null}

            {/* Upcoming Queue Table */}
            <VStack gap={3}>
              <HStack justify="between" align="center" wrap="wrap" gap={2}>
                <HStack gap={2} align="center">
                  <Heading level={3} type="display-3">
                    Upcoming queue
                  </Heading>
                  <Badge label={sortedQueue.length} variant="neutral" />
                </HStack>

                <SegmentedControl
                  label="Sort queue"
                  value={queueSort}
                  onChange={(v) => setQueueSort(v as QueueSort)}
                  size="sm"
                >
                  <SegmentedControlItem value="asc" label="Earliest" />
                  <SegmentedControlItem value="desc" label="Latest" />
                  <SegmentedControlItem value="failed_first" label="Errors first" />
                </SegmentedControl>
              </HStack>

              {sortedQueue.length === 0 ? (
                <EmptyState
                  icon={<Icon icon={FilmGlyph} />}
                  title="No matching scheduled posts"
                  description="Open any rendered clip in your library or use the scheduler above to queue a post."
                  actions={<Button label="Open library" href="/library" variant="secondary" />}
                />
              ) : (
                <Card padding={0} variant="default">
                  <Table<QueueRow>
                    data={sortedQueue as QueueRow[]}
                    columns={queueColumns}
                    idKey="id"
                    density="balanced"
                    dividers="rows"
                    hasHover
                  />
                </Card>
              )}
            </VStack>
        </VStack>

        {/* Right Inspector Drawer */}
        <VStack className="w-full min-w-0 flex-[1_1_320px] lg:sticky lg:top-20">
        <Card padding={5} variant="muted">
          <VStack gap={4}>
            <HStack justify="between" align="center">
              <VStack gap={0.5}>
                <Text type="label" color="accent">
                  {selectedPost ? "POST TELEMETRY" : "DAILY MANIFEST"}
                </Text>
                <Heading level={3} type="display-3">
                  {selectedPost
                    ? `Post ${selectedPost.id.slice(0, 8)}`
                    : `${String(selectedDay).padStart(2, "0")} ${MONTHS[cursorMonth]} ${cursorYear}`}
                </Heading>
              </VStack>

              {selectedPost ? (
                <Button
                  label="← Day list"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedPostId(null)}
                />
              ) : null}
            </HStack>

            <Divider />

            {selectedPost ? (
              <VStack gap={4}>
                <HStack justify="between" align="center">
                  <Badge label={selectedPost.platform.toUpperCase()} variant="info" />
                  <Badge
                    label={STATUS_META[selectedPost.status].label}
                    variant={STATUS_META[selectedPost.status].badge}
                  />
                </HStack>

                <MetadataList title="Dispatch details" orientation="vertical" label={{ position: "start" }}>
                  <MetadataListItem label="Scheduled (IST)">
                    <Text type="supporting">{displayTime(selectedPost.scheduled_at)}</Text>
                  </MetadataListItem>
                  <MetadataListItem
                    label={selectedPost.platform === "youtube" ? "YouTube title" : "Instagram caption"}
                  >
                    <Text type="supporting">{getPostTitle(selectedPost)}</Text>
                  </MetadataListItem>
                  <MetadataListItem label="Job ID">
                    <HStack gap={2} align="center" justify="between" width="100%">
                      <Text type="code" maxLines={1}>
                        {selectedPost.job_id}
                      </Text>
                      <Button
                        label="Copy"
                        variant="ghost"
                        size="sm"
                        onClick={() => void copyValue("Job ID", selectedPost.job_id)}
                      />
                    </HStack>
                  </MetadataListItem>
                  <MetadataListItem label="Clip ID">
                    <HStack gap={2} align="center" justify="between" width="100%">
                      <Text type="code" maxLines={1}>
                        {selectedPost.clip_id}
                      </Text>
                      <Button
                        label="Copy"
                        variant="ghost"
                        size="sm"
                        onClick={() => void copyValue("Clip ID", selectedPost.clip_id)}
                      />
                    </HStack>
                  </MetadataListItem>
                </MetadataList>

                {selectedPost.last_error ? (
                  <Banner
                    status="error"
                    title="Pipeline error"
                    description={selectedPost.last_error}
                  />
                ) : null}

                {selectedPost.status === "failed" ? (
                  <Button
                    label={retryingId === selectedPost.id ? "Queuing retry…" : "Retry scheduled post"}
                    variant="primary"
                    width="100%"
                    isLoading={retryingId === selectedPost.id}
                    onClick={() => void handleRetry(selectedPost.id)}
                  />
                ) : null}

                {selectedPost.permalink ? (
                  <Button
                    label="Open published post"
                    href={selectedPost.permalink}
                    target="_blank"
                    rel="noreferrer"
                    variant="secondary"
                    width="100%"
                  />
                ) : null}

                <Button
                  label="Open source job studio"
                  href={`/jobs/${selectedPost.job_id}`}
                  variant="ghost"
                  width="100%"
                  endContent={<Icon icon={ArrowRightGlyph} size="sm" />}
                />
              </VStack>
            ) : selectedDayPosts.length === 0 ? (
              <EmptyState
                title="No dispatches scheduled"
                description="No posts are scheduled for this date."
                actions={<Button label="Browse library" href="/library" variant="secondary" size="sm" />}
              />
            ) : (
              <List hasDividers density="compact">
                {selectedDayPosts.map((post) => {
                  const meta = STATUS_META[post.status];
                  return (
                    <ListItem
                      key={post.id}
                      startContent={
                        <StatusDot
                          variant={meta.dot}
                          label={meta.label}
                          isPulsing={post.status === "processing"}
                        />
                      }
                      label={getPostTitle(post)}
                      description={`${post.platform.toUpperCase()} · ${getISTParts(post.scheduled_at).time} IST`}
                      endContent={<Badge label={meta.label} variant={meta.badge} />}
                      onClick={() => setSelectedPostId(post.id)}
                    />
                  );
                })}
              </List>
            )}

            <Divider />

            <Text type="supporting" color="secondary">
              Shortcuts: <Kbd keys="[" /> / <Kbd keys="]" /> Month · <Kbd keys="t" /> Today ·{" "}
              <Kbd keys="1" /> / <Kbd keys="2" /> / <Kbd keys="3" /> View
            </Text>
          </VStack>
        </Card>
        </VStack>
      </HStack>
    </VStack>
  );
}
