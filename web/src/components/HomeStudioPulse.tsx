"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Section } from "@astryxdesign/core/Section";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { fetchJobs } from "@/lib/api";
import type { JobView } from "@/lib/types";
import { FilmGlyph, PlusGlyph, ScissorsGlyph } from "@/components/StudioIcons";

function statusMeta(job: JobView) {
  if (job.status === "done") {
    return { dot: "success" as const, label: "Ready", pulsing: false };
  }
  if (job.status === "error") {
    return { dot: "error" as const, label: "Attention needed", pulsing: false };
  }
  return {
    dot: "accent" as const,
    label: job.status === "queued" ? "Queued" : `Cutting ${Math.round(job.progress * 100)}%`,
    pulsing: true,
  };
}

function summarizeTitle(job: JobView) {
  const best = (job.clips || []).reduce(
    (top, current) => (!top || current.score > top.score ? current : top),
    job.clips[0],
  );
  if (best?.title) return best.title;
  return job.source.replace(/^https?:\/\/(www\.)?/, "");
}

export function HomeStudioPulse() {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const items = await fetchJobs();
        if (!ignore) {
          setJobs(items);
          setError("");
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Could not load workspace activity.");
        }
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, [reloadTick]);

  const hasActiveJobs = (jobs || []).some((j) => j.status === "running" || j.status === "queued");

  useEffect(() => {
    if (!hasActiveJobs) return;
    const poll = () => {
      if (document.visibilityState === "visible") {
        setReloadTick((t) => t + 1);
      }
    };
    const timer = window.setInterval(poll, 4000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [hasActiveJobs]);

  const totalJobs = jobs?.length ?? 0;
  const activeJobs = (jobs || []).filter((j) => j.status === "running" || j.status === "queued");
  const totalClips = (jobs || []).reduce((sum, j) => sum + (j.clips?.length || 0), 0);
  const keptClips = (jobs || []).reduce(
    (sum, j) => sum + (j.clips || []).filter((c) => c.kept).length,
    0,
  );
  const recentJobs = (jobs || []).slice(0, 4);

  return (
    <Section variant="section" padding={5} className="rounded-lg border border-border">
      <VStack gap={5}>
        <HStack gap={4} hAlign="between" vAlign="center" wrap="wrap">
          <VStack gap={1}>
            <Text type="label" size="2xs" color="accent" weight="bold">
              LIVE CUT ROOM TELEMETRY
            </Text>
            <Heading level={2}>Workspace Activity</Heading>
          </VStack>
          <HStack gap={2} vAlign="center">
            <Link href="/library" isStandalone size="sm">
              Open full library
            </Link>
            <Button
              variant="primary"
              size="sm"
              label="Create New Cut"
              icon={<Icon icon={PlusGlyph} size="sm" />}
              onClick={() => router.push("/new")}
            />
          </HStack>
        </HStack>

        {error ? (
          <Banner
            status="error"
            title="Could not reach local job store"
            description={error}
            endContent={
              <Button
                variant="secondary"
                size="sm"
                label="Retry"
                onClick={() => setReloadTick((t) => t + 1)}
              />
            }
          />
        ) : null}

        {jobs === null && !error ? (
          <VStack gap={3}>
            <Grid columns={{ minWidth: 160, max: 4 }} gap={3}>
              {[0, 1, 2, 3].map((i) => (
                <Card key={i} padding={3}>
                  <VStack gap={2}>
                    <Skeleton height={14} width="50%" />
                    <Skeleton height={24} width="35%" />
                  </VStack>
                </Card>
              ))}
            </Grid>
            <Skeleton height={120} width="100%" />
          </VStack>
        ) : null}

        {jobs !== null ? (
          <VStack gap={4}>
            <Grid columns={{ minWidth: 160, max: 4 }} gap={3}>
              <Card padding={3} variant="muted">
                <VStack gap={1}>
                  <Text type="supporting" size="2xs">
                    Projects in Library
                  </Text>
                  <Text type="display-3" weight="bold" hasTabularNumbers>
                    {totalJobs}
                  </Text>
                </VStack>
              </Card>
              <Card padding={3} variant="muted">
                <VStack gap={1}>
                  <Text type="supporting" size="2xs">
                    Active Pipelines
                  </Text>
                  <HStack gap={2} vAlign="center">
                    <Text type="display-3" weight="bold" hasTabularNumbers color={activeJobs.length > 0 ? "accent" : "primary"}>
                      {activeJobs.length}
                    </Text>
                    {activeJobs.length > 0 ? (
                      <StatusDot variant="accent" isPulsing label="Pipelines running" />
                    ) : null}
                  </HStack>
                </VStack>
              </Card>
              <Card padding={3} variant="muted">
                <VStack gap={1}>
                  <Text type="supporting" size="2xs">
                    Extracted Clips
                  </Text>
                  <Text type="display-3" weight="bold" hasTabularNumbers>
                    {totalClips}
                  </Text>
                </VStack>
              </Card>
              <Card padding={3} variant="muted">
                <VStack gap={1}>
                  <Text type="supporting" size="2xs">
                    Kept Shorts
                  </Text>
                  <Text type="display-3" weight="bold" hasTabularNumbers>
                    {keptClips}
                  </Text>
                </VStack>
              </Card>
            </Grid>

            {recentJobs.length === 0 ? (
              <EmptyState
                isCompact
                icon={<Icon icon={FilmGlyph} size="lg" color="accent" />}
                title="Ready for your first cut"
                description="Drop in a long-form video or YouTube URL in the dedicated New Cut studio to extract ranked vertical shorts."
                actions={
                  <Button
                    variant="primary"
                    label="Launch New Cut"
                    icon={<Icon icon={ScissorsGlyph} size="sm" />}
                    onClick={() => router.push("/new")}
                  />
                }
              />
            ) : (
              <Card padding={4}>
                <List
                  hasDividers
                  edge="outset"
                  header={
                    <HStack hAlign="between" vAlign="center" paddingBlockEnd={2}>
                      <Heading level={3}>Recent Cut Sessions</Heading>
                      <Text type="supporting" size="2xs" hasTabularNumbers>
                        {recentJobs.length} shown
                      </Text>
                    </HStack>
                  }
                >
                  {recentJobs.map((job) => {
                    const meta = statusMeta(job);
                    const clipCount = job.clips?.length || 0;
                    const active = job.status === "running" || job.status === "queued";
                    return (
                      <ListItem
                        key={job.id}
                        itemKey={job.id}
                        href={`/jobs/${job.id}`}
                        label={summarizeTitle(job)}
                        description={
                          active
                            ? job.progressMessage || `${job.provider} · ${meta.label}`
                            : `${job.provider} · ${clipCount} clip${clipCount === 1 ? "" : "s"} · ${job.vertical ? "9:16" : "Source"}`
                        }
                        startContent={
                          <StatusDot
                            variant={meta.dot}
                            isPulsing={meta.pulsing}
                            label={meta.label}
                          />
                        }
                        endContent={
                          active ? (
                            <VStack width={120} gap={1}>
                              <ProgressBar
                                label={`Progress for ${job.id}`}
                                isLabelHidden
                                value={Math.round(job.progress * 100)}
                                variant="accent"
                              />
                              <Text type="code" size="2xs" color="secondary" justify="end" hasTabularNumbers>
                                {Math.round(job.progress * 100)}%
                              </Text>
                            </VStack>
                          ) : (
                            <HStack gap={2} vAlign="center">
                              {job.status === "error" ? (
                                <Badge variant="error" label="Failed" />
                              ) : (
                                <Text type="supporting" size="2xs" hasTabularNumbers>
                                  {clipCount} clips
                                </Text>
                              )}
                              <Icon icon="chevronRight" size="sm" color="secondary" />
                            </HStack>
                          )
                        }
                      />
                    );
                  })}
                </List>
              </Card>
            )}
          </VStack>
        ) : null}
      </VStack>
    </Section>
  );
}
