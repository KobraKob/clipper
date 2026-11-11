"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Divider } from "@astryxdesign/core/Divider";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { Kbd } from "@astryxdesign/core/Kbd";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { ClipCard } from "@/components/ClipCard";
import { PipelineStrip } from "@/components/PipelineStrip";
import {
  FilmGlyph,
  GridGlyph,
  ListGlyph,
  PlusGlyph,
  RefreshGlyph,
  ScissorsGlyph,
  TrashGlyph,
} from "@/components/StudioIcons";
import { WaveBars } from "@/components/WaveBars";
import {
  deleteJob,
  fetchJob,
  fetchJobLogs,
  fetchJobStatus,
  patchClip,
  rerenderClip,
} from "@/lib/api";
import { PIPELINE_STAGES, type Clip, type JobView, type SocialTemplate } from "@/lib/types";

type Filter = "all" | "kept" | "dropped";
type Sort = "score" | "start" | "duration";
type ViewMode = "grid" | "list";

const PREFS_KEY = "jobstudio:prefs";

function sourceDisplayTitle(job: JobView): string {
  if (job.sourceKind === "file") {
    const parts = job.source.split(/[\\/]/);
    return parts[parts.length - 1] || job.source || "Uploaded video";
  }
  try {
    const parsed = new URL(job.source);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return job.source || "Cut Studio";
  }
}

export function JobStudio({ jobId }: { jobId: string }) {
  const router = useRouter();
  const toast = useToast();

  const [job, setJob] = useState<JobView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyClipIds, setBusyClipIds] = useState<Set<string>>(() => new Set());
  const [bulkLabel, setBulkLabel] = useState("");

  const [logs, setLogs] = useState("");
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsError, setLogsError] = useState("");

  const [clipFilter, setClipFilter] = useState<Filter>("all");
  const [clipSort, setClipSort] = useState<Sort>("score");
  const [clipView, setClipView] = useState<ViewMode>("grid");
  const [clipSearch, setClipSearch] = useState("");

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const hasLoadedPrefsRef = useRef(false);

  /* Load persisted view preferences */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { sort?: Sort; view?: ViewMode };
        queueMicrotask(() => {
          if (parsed.sort) setClipSort(parsed.sort);
          if (parsed.view) setClipView(parsed.view);
        });
      }
    } catch {
      /* ignore storage errors */
    } finally {
      hasLoadedPrefsRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedPrefsRef.current) return;
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ sort: clipSort, view: clipView }));
    } catch {
      /* ignore storage errors */
    }
  }, [clipSort, clipView]);

  const loadJob = useCallback(async () => {
    try {
      const data = await fetchJob(jobId);
      setJob(data);
      setNotFound(false);
      setError("");
      if (data.status === "error") setLogsOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load job.";
      if (/not found|404/i.test(msg)) setNotFound(true);
      else setError(msg);
    }
  }, [jobId]);

  useEffect(() => {
    let cancelled = false;
    fetchJob(jobId)
      .then((data) => {
        if (cancelled) return;
        setJob(data);
        setNotFound(false);
        setError("");
        if (data.status === "error") setLogsOpen(true);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to load job.";
        if (/not found|404/i.test(msg)) setNotFound(true);
        else setError(msg);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const isActiveJob = job?.status === "queued" || job?.status === "running";

  /* Poll status while queued or running */
  useEffect(() => {
    if (!isActiveJob) return;
    let cancelled = false;

    const timer = window.setInterval(async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const snap = await fetchJobStatus(jobId);
        if (cancelled) return;
        setJob((prev) =>
          prev
            ? {
                ...prev,
                status: snap.status,
                stageIndex: snap.stageIndex,
                stageId: snap.stageId,
                progress: snap.progress,
                progressMessage: snap.progressMessage,
                error: snap.error,
              }
            : prev,
        );
        if (snap.status === "done" || snap.status === "error") {
          void loadJob();
        }
      } catch {
        /* polling recovers automatically */
      }
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isActiveJob, jobId, loadJob]);

  /* Poll logs when panel is open */
  useEffect(() => {
    if (!logsOpen) return;
    let cancelled = false;

    const pullLogs = async () => {
      try {
        const res = await fetchJobLogs(jobId);
        if (!cancelled) {
          setLogs(res.logs || "");
          setLogsError("");
        }
      } catch (err) {
        if (!cancelled) {
          setLogsError(err instanceof Error ? err.message : "Unable to load worker logs.");
        }
      }
    };

    void pullLogs();
    if (job?.status === "done" || job?.status === "error") return;

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void pullLogs();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [logsOpen, job?.status, jobId]);

  /* Keyboard shortcuts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const editing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (editing) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key.toLowerCase() === "g") {
        setClipView("grid");
      } else if (e.key.toLowerCase() === "l") {
        setClipView("list");
      } else if (e.key.toLowerCase() === "c") {
        setLogsOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const updateClip = useCallback(
    async (clipId: string, patch: { kept?: boolean; start?: number; end?: number }) => {
      setBusyClipIds((prev) => new Set(prev).add(clipId));
      try {
        const updated = await patchClip(jobId, clipId, patch);
        setJob(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Clip update failed.");
      } finally {
        setBusyClipIds((prev) => {
          const next = new Set(prev);
          next.delete(clipId);
          return next;
        });
      }
    },
    [jobId],
  );

  const handleRerender = useCallback(
    async (
      clipId: string,
      start: number,
      end: number,
      captionStyle: string,
      template: SocialTemplate,
      templateDisplayName: string,
      templateHandle: string,
    ) => {
      setBusyClipIds((prev) => new Set(prev).add(clipId));
      try {
        const updated = await rerenderClip(
          jobId,
          clipId,
          start,
          end,
          captionStyle,
          template,
          templateDisplayName,
          templateHandle,
        );
        setJob(updated);
      } finally {
        setBusyClipIds((prev) => {
          const next = new Set(prev);
          next.delete(clipId);
          return next;
        });
      }
    },
    [jobId],
  );

  const clips = useMemo(() => job?.clips ?? [], [job?.clips]);
  const keptClips = useMemo(() => clips.filter((c) => c.kept), [clips]);
  const droppedCount = clips.length - keptClips.length;

  const visibleClips = useMemo(() => {
    const q = clipSearch.trim().toLowerCase();
    const filtered = clips.filter((c) => {
      if (clipFilter === "kept" && !c.kept) return false;
      if (clipFilter === "dropped" && c.kept) return false;
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        c.hook.toLowerCase().includes(q) ||
        c.reason.toLowerCase().includes(q) ||
        c.text.toLowerCase().includes(q)
      );
    });

    const sorted = [...filtered];
    if (clipSort === "score") sorted.sort((a, b) => b.score - a.score);
    else if (clipSort === "start") sorted.sort((a, b) => a.start - b.start);
    else if (clipSort === "duration") {
      sorted.sort((a, b) => b.end - b.start - (a.end - a.start));
    }
    return sorted;
  }, [clips, clipFilter, clipSearch, clipSort]);

  const filtersActive = clipFilter !== "all" || clipSearch.trim().length > 0;

  function resetFilters() {
    setClipFilter("all");
    setClipSearch("");
  }

  async function bulkSetKept(kept: boolean) {
    if (visibleClips.length === 0) return;
    setBusy(true);
    setBulkLabel(kept ? "keeping…" : "dropping…");
    try {
      let latest = job;
      for (const clip of visibleClips) {
        if (clip.kept !== kept) {
          latest = await patchClip(jobId, clip.id, { kept });
        }
      }
      if (latest) setJob(latest);
      toast({
        body: kept ? "Kept all visible clips." : "Dropped all visible clips.",
        uniqueID: "studio-bulk-keep",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk update failed.");
    } finally {
      setBusy(false);
      setBulkLabel("");
    }
  }

  async function confirmDeleteJob() {
    setDeleting(true);
    try {
      await deleteJob(jobId);
      toast({ body: "Cut job deleted.", uniqueID: "studio-delete" });
      router.push("/library");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete job.");
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }

  if (notFound) {
    return (
      <EmptyState
        icon={<Icon icon={FilmGlyph} />}
        title="Cut job not found"
        description={`Job "${jobId}" was deleted or never existed. Start a new cut or browse existing runs in the library.`}
        actions={
          <HStack gap={3}>
            <Button label="New cut" href="/new" variant="primary" icon={<Icon icon={PlusGlyph} />} />
            <Button label="Open library" href="/library" variant="secondary" />
          </HStack>
        }
      />
    );
  }

  if (!job) {
    return (
      <VStack gap={4}>
        <Skeleton height={80} width="100%" />
        <Skeleton height={140} width="100%" />
        <Grid columns={{ minWidth: 280, max: 3 }} gap={4}>
          <Skeleton height={320} width="100%" />
          <Skeleton height={320} width="100%" />
          <Skeleton height={320} width="100%" />
        </Grid>
      </VStack>
    );
  }

  const running = job.status === "queued" || job.status === "running";
  const stageLabel =
    PIPELINE_STAGES[Math.min(job.stageIndex, PIPELINE_STAGES.length - 1)]?.label ?? "Queued";

  return (
    <VStack gap={6}>
      {/* Job Header Card */}
      <Card padding={6} variant="default">
        <VStack gap={5}>
          <HStack justify="between" align="start" wrap="wrap" gap={4}>
            <VStack gap={2} maxWidth={720}>
              <HStack gap={2} align="center" wrap="wrap">
                <StatusDot
                  variant={
                    job.status === "done"
                      ? "success"
                      : job.status === "error"
                        ? "error"
                        : "warning"
                  }
                  label={
                    job.status === "done"
                      ? "Ready"
                      : job.status === "error"
                        ? "Error"
                        : stageLabel
                  }
                  isPulsing={running}
                />
                <Badge
                  label={
                    job.status === "done"
                      ? "Ready"
                      : job.status === "error"
                        ? "Error"
                        : stageLabel
                  }
                  variant={
                    job.status === "done"
                      ? "success"
                      : job.status === "error"
                        ? "error"
                        : "info"
                  }
                />
                <Text type="code" size="2xs" color="secondary">
                  {[
                    job.provider,
                    job.vertical ? "9:16" : "16:9",
                    job.captions ? job.captionStyle || "Captions" : "No captions",
                  ].join(" · ")}
                </Text>
              </HStack>

              <Heading level={1} type="display-2">
                {sourceDisplayTitle(job)}
              </Heading>

              <Text type="supporting" color="secondary">
                {job.source}
              </Text>
            </VStack>

            <HStack gap={2} align="center" wrap="wrap">
              <WaveBars active={running} label={running ? `${Math.round(job.progress * 100)}%` : undefined} />
              <Button
                label="Refresh"
                variant="secondary"
                size="sm"
                icon={<Icon icon={RefreshGlyph} />}
                onClick={() => void loadJob()}
              />
              <Button
                label="New cut"
                href="/new"
                variant="primary"
                size="sm"
                icon={<Icon icon={ScissorsGlyph} />}
              />
              <Button
                label="Delete job"
                variant="destructive"
                size="sm"
                icon={<Icon icon={TrashGlyph} />}
                onClick={() => setDeleteDialogOpen(true)}
              />
            </HStack>
          </HStack>

          <Divider />

          <MetadataList title="Job telemetry" orientation="horizontal" label={{ position: "top" }}>
            <MetadataListItem label="Clips extracted">
              <Text type="supporting">{String(clips.length)}</Text>
            </MetadataListItem>
            <MetadataListItem label="Kept">
              <Text type="supporting">{String(keptClips.length)}</Text>
            </MetadataListItem>
            <MetadataListItem label="Source">
              <Text type="supporting">
                {job.sourceKind === "file" ? "Uploaded file" : "Video URL"}
              </Text>
            </MetadataListItem>
            <MetadataListItem label="Target clips">
              <Text type="supporting">{String(job.clipCount)}</Text>
            </MetadataListItem>
            <MetadataListItem label="Created">
              <Text type="supporting">{new Date(job.createdAt).toLocaleString()}</Text>
            </MetadataListItem>
          </MetadataList>
        </VStack>
      </Card>

      {error ? (
        <Banner
          status="error"
          title="Studio warning"
          description={error}
          isDismissable
          onDismiss={() => setError("")}
        />
      ) : null}

      {job.status === "error" && job.error ? (
        <Banner
          status="error"
          title="Pipeline error"
          description={job.error}
          endContent={
            <Button label="Start another cut" href="/new" variant="secondary" size="sm" />
          }
        />
      ) : null}

      {/* Live 8-stage pipeline stepper */}
      <PipelineStrip
        stageIndex={job.stageIndex}
        stageId={job.stageId}
        status={job.status}
        progress={job.progress}
        progressMessage={job.progressMessage}
      />

      {/* Collapsible Worker Logs */}
      <Card padding={4} variant="muted">
        <Collapsible
          isOpen={logsOpen}
          onOpenChange={setLogsOpen}
          trigger={
            <HStack gap={2} align="center">
              <Text type="label">WORKER LOGS</Text>
              <Kbd keys="c" />
            </HStack>
          }
        >
          <VStack gap={2} paddingBlockStart={3}>
            {logsError ? <Banner status="warning" title={logsError} /> : null}
            <Card padding={3} variant="default">
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-secondary">
                {logs || "Waiting for worker output…"}
              </pre>
            </Card>
          </VStack>
        </Collapsible>
      </Card>

      {/* Clips Section */}
      {clips.length > 0 ? (
        <VStack gap={5}>
          {/* Filter & View Bar */}
          <Card padding={4} variant="default">
            <VStack gap={4}>
              <Grid columns={{ minWidth: 220, max: 3 }} gap={3} align="end">
                <TextInput
                  ref={searchRef}
                  type="search"
                  label="Search clips"
                  placeholder="Search title, hook, reason, transcript… (/)"
                  value={clipSearch}
                  onChange={setClipSearch}
                  hasClear
                  width="100%"
                />

                <SegmentedControl
                  label="Filter kept status"
                  value={clipFilter}
                  onChange={(v) => setClipFilter(v as Filter)}
                  layout="fill"
                >
                  <SegmentedControlItem value="all" label={`All (${clips.length})`} />
                  <SegmentedControlItem value="kept" label={`Kept (${keptClips.length})`} />
                  <SegmentedControlItem value="dropped" label={`Dropped (${droppedCount})`} />
                </SegmentedControl>

                <HStack gap={2} align="end" justify="between" wrap="wrap">
                  <Selector
                    label="Sort clips"
                    value={clipSort}
                    onChange={(v) => setClipSort(v as Sort)}
                    options={[
                      { value: "score", label: "Highest score" },
                      { value: "start", label: "Timeline order" },
                      { value: "duration", label: "Longest duration" },
                    ]}
                  />

                  <SegmentedControl
                    label="Layout view"
                    value={clipView}
                    onChange={(v) => setClipView(v as ViewMode)}
                    size="sm"
                  >
                    <SegmentedControlItem
                      value="grid"
                      label="Grid"
                      icon={<Icon icon={GridGlyph} />}
                      isLabelHidden
                    />
                    <SegmentedControlItem
                      value="list"
                      label="List"
                      icon={<Icon icon={ListGlyph} />}
                      isLabelHidden
                    />
                  </SegmentedControl>
                </HStack>
              </Grid>

              <Divider />

              <HStack justify="between" align="center" wrap="wrap" gap={2}>
                <HStack gap={2} align="center">
                  <Text type="supporting" color="secondary">
                    Showing {visibleClips.length} of {clips.length} clips
                  </Text>
                  {filtersActive ? (
                    <Button label="Clear filters" variant="ghost" size="sm" onClick={resetFilters} />
                  ) : null}
                </HStack>

                <HStack gap={2} wrap="wrap">
                  <Button
                    label={bulkLabel && busy ? `Working (${bulkLabel})` : "Keep shown"}
                    variant="secondary"
                    size="sm"
                    isDisabled={busy || busyClipIds.size > 0 || visibleClips.every((c) => c.kept)}
                    onClick={() => void bulkSetKept(true)}
                  />
                  <Button
                    label="Drop shown"
                    variant="ghost"
                    size="sm"
                    isDisabled={busy || busyClipIds.size > 0 || visibleClips.every((c) => !c.kept)}
                    onClick={() => void bulkSetKept(false)}
                  />
                </HStack>
              </HStack>
            </VStack>
          </Card>

          {visibleClips.length > 0 ? (
            clipView === "grid" ? (
              <Grid columns={{ minWidth: 340, max: 2 }} gap={5} align="start">
                {visibleClips.map((clip: Clip) => (
                  <ClipCard
                    key={clip.id}
                    jobId={jobId}
                    clip={clip}
                    busy={busy || busyClipIds.has(clip.id)}
                    captionsEnabled={job.captions}
                    onKeep={(keptNext) => void updateClip(clip.id, { kept: keptNext })}
                    onTimes={(start, end) => void updateClip(clip.id, { start, end })}
                    onRerender={(start, end, captionStyle, template, displayName, handle) =>
                      handleRerender(
                        clip.id,
                        start,
                        end,
                        captionStyle,
                        template,
                        displayName,
                        handle,
                      )
                    }
                  />
                ))}
              </Grid>
            ) : (
              <VStack gap={4}>
                {visibleClips.map((clip: Clip) => (
                  <ClipCard
                    key={clip.id}
                    jobId={jobId}
                    clip={clip}
                    busy={busy || busyClipIds.has(clip.id)}
                    captionsEnabled={job.captions}
                    onKeep={(keptNext) => void updateClip(clip.id, { kept: keptNext })}
                    onTimes={(start, end) => void updateClip(clip.id, { start, end })}
                    onRerender={(start, end, captionStyle, template, displayName, handle) =>
                      handleRerender(
                        clip.id,
                        start,
                        end,
                        captionStyle,
                        template,
                        displayName,
                        handle,
                      )
                    }
                  />
                ))}
              </VStack>
            )
          ) : (
            <EmptyState
              icon={<Icon icon={FilmGlyph} />}
              title="No matching clips"
              description="No extracted clips match your current search or kept filter."
              actions={<Button label="Reset filters" variant="secondary" onClick={resetFilters} />}
            />
          )}
        </VStack>
      ) : running ? (
        <EmptyState
          icon={<Icon icon={ScissorsGlyph} />}
          title="Extracting clips…"
          description="Transcription, AI scoring, face reframing, and caption rendering are running. This workspace updates automatically."
        />
      ) : (
        <EmptyState
          icon={<Icon icon={FilmGlyph} />}
          title="No clips generated"
          description="This run completed without produced clips. Try adjusting clip count or source footage."
          actions={<Button label="Start new cut" href="/new" variant="primary" />}
        />
      )}

      <AlertDialog
        isOpen={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete this cut job?"
        description="This permanently removes the job record, rendered clip files, and cover frames from local storage."
        actionLabel="Delete job"
        actionVariant="destructive"
        isActionLoading={deleting}
        onAction={confirmDeleteJob}
      />
    </VStack>
  );
}
