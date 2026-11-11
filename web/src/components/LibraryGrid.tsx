"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Divider } from "@astryxdesign/core/Divider";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Kbd } from "@astryxdesign/core/Kbd";
import { Link } from "@astryxdesign/core/Link";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Table, pixel, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { BulkCutUploader } from "@/components/BulkCutUploader";
import {
  ArrowRightGlyph,
  FilmGlyph,
  GridGlyph,
  ListGlyph,
  PlusGlyph,
  RefreshGlyph,
  ScissorsGlyph,
  TrashGlyph,
} from "@/components/StudioIcons";
import { deleteJob, fetchJobs } from "@/lib/api";
import { PIPELINE_STAGES, type JobView } from "@/lib/types";

type LibraryFilter = "all" | "ready" | "processing" | "failed";
type SortMode = "newest" | "oldest" | "most-clips" | "top-score";
type ViewMode = "grid" | "list";

const PREFS_KEY = "library:prefs";

function topScore(job: JobView) {
  return job.clips.reduce((best, c) => Math.max(best, c.score), 0);
}

function stageLabel(job: JobView) {
  if (job.status === "done") return "Ready";
  if (job.status === "error") return "Error";
  return PIPELINE_STAGES[Math.min(job.stageIndex, PIPELINE_STAGES.length - 1)]?.label ?? "Queued";
}

function sourceDisplay(job: JobView) {
  if (job.sourceKind === "file") {
    const parts = job.source.split(/[\\/]/);
    return parts[parts.length - 1] || job.source;
  }
  try {
    const parsed = new URL(job.source);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return job.source;
  }
}

type TableRowData = JobView & Record<string, unknown>;

export function LibraryGrid() {
  const router = useRouter();
  const toast = useToast();

  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<SortMode>("newest");
  const [view, setView] = useState<ViewMode>("grid");
  const [search, setSearch] = useState("");
  const [showBatchImport, setShowBatchImport] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const hasLoadedPrefsRef = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { sort?: SortMode; view?: ViewMode };
        queueMicrotask(() => {
          if (parsed.sort) setSort(parsed.sort);
          if (parsed.view) setView(parsed.view);
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
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ sort, view }));
    } catch {
      /* ignore storage errors */
    }
  }, [sort, view]);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const data = await fetchJobs();
      setJobs(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load projects.");
    } finally {
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchJobs()
      .then((data) => {
        if (cancelled) return;
        setJobs(data);
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load projects.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasActive = useMemo(
    () => (jobs ?? []).some((j) => j.status === "queued" || j.status === "running"),
    [jobs],
  );

  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [hasActive, load]);

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

      const key = e.key.toLowerCase();
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (key === "g") {
        setView("grid");
      } else if (key === "l") {
        setView("list");
      } else if (key === "b") {
        setShowBatchImport((o) => !o);
      } else if (key === "r") {
        void load(true);
      } else if (key === "n") {
        router.push("/new");
      } else if (key === "p") {
        router.push("/calendar");
      } else if (e.key === "Escape") {
        setSelected(new Set());
        setSearch("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load, router]);

  const counts = useMemo(() => {
    const list = jobs ?? [];
    return {
      all: list.length,
      ready: list.filter((j) => j.status === "done").length,
      processing: list.filter((j) => j.status === "queued" || j.status === "running").length,
      failed: list.filter((j) => j.status === "error").length,
    };
  }, [jobs]);

  const visible = useMemo(() => {
    const list = jobs ?? [];
    const q = search.trim().toLowerCase();

    const filtered = list.filter((job) => {
      if (filter === "ready" && job.status !== "done") return false;
      if (filter === "processing" && job.status !== "queued" && job.status !== "running") return false;
      if (filter === "failed" && job.status !== "error") return false;
      if (!q) return true;
      return (
        job.id.toLowerCase().includes(q) ||
        job.source.toLowerCase().includes(q) ||
        job.provider.toLowerCase().includes(q) ||
        job.clips.some((c) => c.title.toLowerCase().includes(q))
      );
    });

    const sorted = [...filtered];
    if (sort === "newest") {
      sorted.sort((a, b) => b.createdAt - a.createdAt);
    } else if (sort === "oldest") {
      sorted.sort((a, b) => a.createdAt - b.createdAt);
    } else if (sort === "most-clips") {
      sorted.sort((a, b) => b.clips.length - a.clips.length);
    } else if (sort === "top-score") {
      sorted.sort((a, b) => topScore(b) - topScore(a));
    }
    return sorted;
  }, [jobs, filter, search, sort]);

  const visibleIds = useMemo(() => visible.map((j) => j.id), [visible]);
  const selectedVisibleCount = visibleIds.filter((id) => selected.has(id)).length;
  const allSelectedState: boolean | "indeterminate" =
    visibleIds.length > 0 && selectedVisibleCount === visibleIds.length
      ? true
      : selectedVisibleCount > 0
        ? "indeterminate"
        : false;

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        visibleIds.forEach((id) => next.add(id));
      } else {
        visibleIds.forEach((id) => next.delete(id));
      }
      return next;
    });
  }

  async function confirmRemoveJobs() {
    if (!pendingDeleteIds || pendingDeleteIds.length === 0) return;
    const ids = pendingDeleteIds;
    setDeletingIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });

    const results = await Promise.allSettled(ids.map((id) => deleteJob(id)));
    const removed = ids.filter((_, idx) => results[idx].status === "fulfilled");

    if (removed.length > 0) {
      setJobs((prev) => (prev ? prev.filter((j) => !removed.includes(j.id)) : prev));
      setSelected((prev) => {
        const next = new Set(prev);
        removed.forEach((id) => next.delete(id));
        return next;
      });
      toast({
        body: `Deleted ${removed.length} ${removed.length === 1 ? "project" : "projects"}.`,
        uniqueID: "library-delete",
      });
    }

    const failed = ids.length - removed.length;
    if (failed > 0) {
      setError(`${failed} of ${ids.length} projects could not be deleted.`);
    }

    setDeletingIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setPendingDeleteIds(null);
  }

  const filterTiles: {
    value: LibraryFilter;
    label: string;
    count: number;
    dot: "success" | "warning" | "error" | "neutral";
  }[] = [
    { value: "all", label: "All projects", count: counts.all, dot: "neutral" },
    { value: "ready", label: "Ready to review", count: counts.ready, dot: "success" },
    { value: "processing", label: "In progress", count: counts.processing, dot: "warning" },
    { value: "failed", label: "Needs attention", count: counts.failed, dot: "error" },
  ];

  const tableColumns: TableColumn<TableRowData>[] = [
    {
      key: "select",
      header: "",
      width: pixel(44),
      renderCell: (row) => (
        <CheckboxInput
          label={`Select ${sourceDisplay(row)}`}
          isLabelHidden
          value={selected.has(row.id)}
          onChange={() => toggleSelect(row.id)}
          size="sm"
        />
      ),
    },
    {
      key: "source",
      header: "Project",
      width: proportional(2, { minWidth: 200 }),
      renderCell: (row) => (
        <VStack gap={0.5}>
          <Link href={`/jobs/${row.id}`} isStandalone weight="semibold">
            {sourceDisplay(row)}
          </Link>
          <Text type="code" color="secondary">
            {row.id.slice(0, 8)} · {row.provider}
          </Text>
        </VStack>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: pixel(140),
      renderCell: (row) => (
        <HStack gap={1.5} align="center">
          <StatusDot
            variant={
              row.status === "done"
                ? "success"
                : row.status === "error"
                  ? "error"
                  : "warning"
            }
            label={stageLabel(row)}
            isPulsing={row.status === "queued" || row.status === "running"}
          />
          <Badge
            label={stageLabel(row)}
            variant={
              row.status === "done"
                ? "success"
                : row.status === "error"
                  ? "error"
                  : "info"
            }
          />
        </HStack>
      ),
    },
    {
      key: "clips",
      header: "Clips",
      width: pixel(110),
      renderCell: (row) => (
        <Text type="body" hasTabularNumbers>
          {row.clips.length} / {row.clipCount}
        </Text>
      ),
    },
    {
      key: "topScore",
      header: "Top Score",
      width: pixel(110),
      renderCell: (row) => (
        <Text
          type="body"
          hasTabularNumbers
          weight={topScore(row) >= 80 ? "semibold" : undefined}
          color={topScore(row) >= 80 ? "accent" : "secondary"}
        >
          {row.clips.length > 0 ? String(topScore(row)) : "—"}
        </Text>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      width: pixel(160),
      renderCell: (row) => (
        <HStack gap={1.5} align="center">
          <Button
            label="Open"
            href={`/jobs/${row.id}`}
            variant="secondary"
            size="sm"
            endContent={<Icon icon={ArrowRightGlyph} size="sm" />}
          />
          <IconButton
            label={`Delete ${sourceDisplay(row)}`}
            tooltip="Delete project"
            icon={<Icon icon={TrashGlyph} />}
            variant="ghost"
            size="sm"
            isLoading={deletingIds.has(row.id)}
            onClick={() => setPendingDeleteIds([row.id])}
          />
        </HStack>
      ),
    },
  ];

  return (
    <VStack gap={6}>
      {/* Filter KPI strip */}
      <Grid columns={{ minWidth: 180, max: 4 }} gap={3}>
        {filterTiles.map((tile) => {
          const active = filter === tile.value;
          return (
            <ClickableCard
              key={tile.value}
              label={`Filter: ${tile.label}`}
              onClick={() => setFilter(tile.value)}
              variant={active ? "default" : "muted"}
              padding={4}
            >
              <VStack gap={2}>
                <HStack justify="between" align="center">
                  <HStack gap={1.5} align="center">
                    <StatusDot variant={tile.dot} label={tile.label} />
                    <Text type="label" color="secondary">
                      {tile.label}
                    </Text>
                  </HStack>
                  {active ? <Badge label="Active" variant="info" /> : null}
                </HStack>
                <Text type="display-3" hasTabularNumbers>
                  {jobs === null ? "—" : tile.count}
                </Text>
              </VStack>
            </ClickableCard>
          );
        })}
      </Grid>

      {/* Collapsible Batch Import */}
      <Card id="batch" padding={5} variant="default">
        <Collapsible
          isOpen={showBatchImport}
          onOpenChange={setShowBatchImport}
          trigger={
            <HStack justify="between" align="center" width="100%" gap={3} wrap="wrap">
              <HStack gap={3} align="center">
                <Icon icon={PlusGlyph} size="md" color="accent" />
                <VStack gap={0.5}>
                  <Text type="body" weight="semibold">
                    Batch import multiple videos
                  </Text>
                  <Text type="supporting" color="secondary">
                    Upload several long-form videos at once with shared caption and audio presets.
                  </Text>
                </VStack>
              </HStack>
              <Kbd keys="b" />
            </HStack>
          }
        >
          <VStack paddingBlockStart={4}>
            <Divider />
            <VStack paddingBlockStart={4}>
              <BulkCutUploader onCreated={() => void load(false)} />
            </VStack>
          </VStack>
        </Collapsible>
      </Card>

      {error ? (
        <Banner
          status="error"
          title="Library error"
          description={error}
          isDismissable
          onDismiss={() => setError("")}
          endContent={
            <Button label="Retry" variant="secondary" size="sm" onClick={() => void load(true)} />
          }
        />
      ) : null}

      {/* Toolbar */}
      <Card padding={4} variant="default">
        <VStack gap={4}>
          <Grid columns={{ minWidth: 220, max: 3 }} gap={3} align="end">
            <TextInput
              ref={searchRef}
              type="search"
              label="Search projects"
              placeholder="Search title, URL, provider, or ID… (/)"
              value={search}
              onChange={setSearch}
              hasClear
              width="100%"
            />

            <Selector
              label="Sort projects"
              value={sort}
              onChange={(v) => setSort(v as SortMode)}
              options={[
                { value: "newest", label: "Newest first" },
                { value: "oldest", label: "Oldest first" },
                { value: "most-clips", label: "Most clips" },
                { value: "top-score", label: "Highest clip score" },
              ]}
              width="100%"
            />

            <HStack justify="between" align="end" gap={2} wrap="wrap">
              <SegmentedControl
                label="View mode"
                value={view}
                onChange={(v) => setView(v as ViewMode)}
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

              <Button
                label={refreshing ? "Refreshing…" : "Refresh"}
                variant="secondary"
                size="sm"
                isLoading={refreshing}
                icon={<Icon icon={RefreshGlyph} />}
                endContent={<Kbd keys="r" />}
                onClick={() => void load(true)}
              />
            </HStack>
          </Grid>

          <Divider />

          <HStack justify="between" align="center" wrap="wrap" gap={3}>
            <HStack gap={3} align="center" wrap="wrap">
              <CheckboxInput
                label="Select visible"
                value={allSelectedState}
                onChange={toggleSelectAll}
                size="sm"
              />
              {selectedIds.length > 0 ? (
                <HStack gap={2} align="center">
                  <Badge label={`${selectedIds.length} selected`} variant="info" />
                  <Button
                    label={`Delete ${selectedIds.length}`}
                    variant="destructive"
                    size="sm"
                    icon={<Icon icon={TrashGlyph} />}
                    onClick={() => setPendingDeleteIds(selectedIds)}
                  />
                  <Button
                    label="Clear"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelected(new Set())}
                  />
                </HStack>
              ) : null}
            </HStack>

            <HStack gap={3} align="center" wrap="wrap">
              {hasActive ? (
                <HStack gap={1.5} align="center">
                  <StatusDot variant="warning" label="Live updates active" isPulsing />
                  <Text type="supporting" color="accent">
                    Live updates active
                  </Text>
                </HStack>
              ) : null}
              <Text type="supporting" color="secondary">
                Shortcuts: <Kbd keys="n" /> New cut · <Kbd keys="p" /> Calendar · <Kbd keys="b" /> Batch
              </Text>
            </HStack>
          </HStack>
        </VStack>
      </Card>

      {/* Content */}
      {jobs === null ? (
        <Grid columns={{ minWidth: 300, max: 3 }} gap={4}>
          <Skeleton height={220} width="100%" />
          <Skeleton height={220} width="100%" />
          <Skeleton height={220} width="100%" />
        </Grid>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={<Icon icon={ScissorsGlyph} />}
          title="No cut projects yet"
          description="Your workspace is clean. Launch your first cut or open batch import above to queue several videos."
          actions={
            <HStack gap={3}>
              <Button label="New cut" href="/new" variant="primary" icon={<Icon icon={PlusGlyph} />} />
              <Button
                label="Open batch import"
                variant="secondary"
                onClick={() => setShowBatchImport(true)}
              />
            </HStack>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Icon icon={FilmGlyph} />}
          title="No matching projects"
          description="No projects match the active status filter or search query."
          actions={
            <Button
              label="Clear filters"
              variant="secondary"
              onClick={() => {
                setFilter("all");
                setSearch("");
              }}
            />
          }
        />
      ) : view === "list" ? (
        <Card padding={0} variant="default">
          <Table<TableRowData>
            data={visible as TableRowData[]}
            columns={tableColumns}
            idKey="id"
            density="balanced"
            dividers="rows"
            hasHover
          />
        </Card>
      ) : (
        <Grid columns={{ minWidth: 310, max: 3 }} gap={4} align="stretch">
          {visible.map((job) => {
            const activeRun = job.status === "queued" || job.status === "running";
            const score = topScore(job);
            const keptCount = job.clips.filter((c) => c.kept).length;
            return (
              <Card key={job.id} padding={5} variant="default">
                <VStack gap={4} height="100%" justify="between">
                  <VStack gap={3}>
                    <HStack justify="between" align="center" gap={2}>
                      <CheckboxInput
                        label={`Select ${sourceDisplay(job)}`}
                        isLabelHidden
                        value={selected.has(job.id)}
                        onChange={() => toggleSelect(job.id)}
                        size="sm"
                      />
                      <HStack gap={1.5} align="center">
                        <StatusDot
                          variant={
                            job.status === "done"
                              ? "success"
                              : job.status === "error"
                                ? "error"
                                : "warning"
                          }
                          label={stageLabel(job)}
                          isPulsing={activeRun}
                        />
                        <Badge
                          label={stageLabel(job)}
                          variant={
                            job.status === "done"
                              ? "success"
                              : job.status === "error"
                                ? "error"
                                : "info"
                          }
                        />
                      </HStack>
                    </HStack>

                    <VStack gap={1}>
                      <Heading level={3} type="display-3">
                        {sourceDisplay(job)}
                      </Heading>
                      <Text type="code" color="secondary" maxLines={1}>
                        {job.source}
                      </Text>
                    </VStack>

                    {activeRun ? (
                      <ProgressBar
                        label={job.progressMessage || stageLabel(job)}
                        value={Math.max(4, Math.round(job.progress * 100))}
                        max={100}
                        hasValueLabel
                        variant="accent"
                      />
                    ) : null}

                    {job.status === "error" && job.error ? (
                      <Banner status="error" title="Pipeline error" description={job.error} />
                    ) : null}

                    <MetadataList title="Project stats" orientation="horizontal" label={{ position: "top" }}>
                      <MetadataListItem label="Clips">
                        <Text type="supporting">{`${job.clips.length} (${keptCount} kept)`}</Text>
                      </MetadataListItem>
                      <MetadataListItem label="Top score">
                        <Text type="supporting">{score > 0 ? String(score) : "—"}</Text>
                      </MetadataListItem>
                      <MetadataListItem label="Provider">
                        <Text type="supporting">{job.provider}</Text>
                      </MetadataListItem>
                    </MetadataList>
                  </VStack>

                  <VStack gap={3}>
                    <Divider />
                    <HStack justify="between" align="center">
                      <Text type="supporting" color="secondary">
                        {new Date(job.createdAt).toLocaleDateString()}
                      </Text>
                      <HStack gap={2} align="center">
                        <IconButton
                          label={`Delete ${sourceDisplay(job)}`}
                          tooltip="Delete project"
                          icon={<Icon icon={TrashGlyph} />}
                          variant="ghost"
                          size="sm"
                          isLoading={deletingIds.has(job.id)}
                          onClick={() => setPendingDeleteIds([job.id])}
                        />
                        <Button
                          label="Open studio"
                          href={`/jobs/${job.id}`}
                          variant="primary"
                          size="sm"
                          endContent={<Icon icon={ArrowRightGlyph} size="sm" />}
                        />
                      </HStack>
                    </HStack>
                  </VStack>
                </VStack>
              </Card>
            );
          })}
        </Grid>
      )}

      <AlertDialog
        isOpen={pendingDeleteIds !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteIds(null);
        }}
        title={
          pendingDeleteIds && pendingDeleteIds.length > 1
            ? `Delete ${pendingDeleteIds.length} projects?`
            : "Delete this project?"
        }
        description="This permanently removes the selected job records and rendered clips from local workspace storage."
        actionLabel={
          pendingDeleteIds && pendingDeleteIds.length > 1
            ? `Delete ${pendingDeleteIds.length} projects`
            : "Delete project"
        }
        actionVariant="destructive"
        isActionLoading={deletingIds.size > 0}
        onAction={confirmRemoveJobs}
      />
    </VStack>
  );
}
