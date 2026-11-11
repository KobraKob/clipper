"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { DateTimeInput, type ISODateTimeString } from "@astryxdesign/core/DateTimeInput";
import { Divider } from "@astryxdesign/core/Divider";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { useToast } from "@astryxdesign/core/Toast";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { PlusGlyph } from "@/components/StudioIcons";
import { fetchJobs, scheduleClip } from "@/lib/api";
import type { JobView, Platform } from "@/lib/types";

type ClipOption = {
  value: string;
  jobId: string;
  clipId: string;
  label: string;
};

function defaultScheduleTime() {
  const date = new Date(Date.now() + 3600_000);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toClipOptions(jobs: JobView[]): ClipOption[] {
  return jobs
    .filter((job) => job.status === "done")
    .flatMap((job) =>
      job.clips
        .filter((clip) => clip.kept)
        .map((clip) => ({
          value: `${job.id}::${clip.id}`,
          jobId: job.id,
          clipId: clip.id,
          label: `${clip.title} — ${job.source}`,
        })),
    );
}

export function CalendarScheduler() {
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<ClipOption[]>([]);
  const [jobClip, setJobClip] = useState("");
  const [platform, setPlatform] = useState<Platform | "both">("youtube");
  const [scheduledAt, setScheduledAt] = useState(defaultScheduleTime);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");

  async function toggleScheduler() {
    const next = !open;
    setOpen(next);
    setError("");
    if (!next) return;

    setLoading(true);
    try {
      const jobs = await fetchJobs();
      const loaded = toClipOptions(jobs);
      setOptions(loaded);
      setJobClip((cur) => cur || loaded[0]?.value || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load library clips.");
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const selected = options.find((o) => o.value === jobClip);
    if (!selected) {
      setError("Select a finished, kept clip from your library first.");
      return;
    }
    const date = new Date(scheduledAt);
    if (!scheduledAt || Number.isNaN(date.getTime())) {
      setError("Enter a valid publish date and time.");
      return;
    }

    setBusy(true);
    try {
      setStage("Uploading MP4 to cloud storage…");
      await scheduleClip(selected.jobId, selected.clipId, platform, date.toISOString());
      setStage("");
      setOpen(false);
      toast({ body: "Clip uploaded and scheduled.", uniqueID: "calendar-schedule-ok" });
      router.refresh();
    } catch (reason) {
      setStage("");
      setError(reason instanceof Error ? reason.message : "Scheduling failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padding={5} variant="default">
      <VStack gap={4}>
        <HStack justify="between" align="center" wrap="wrap" gap={3}>
          <VStack gap={1} maxWidth={640}>
            <Text type="label" color="accent">
              NEW QUEUED VIDEO
            </Text>
            <Heading level={2} type="display-3">
              Schedule a finished clip
            </Heading>
            <Text type="supporting" color="secondary">
              Pick a kept clip from your library. Chop Shop uploads the rendered MP4 to private storage before creating the dispatch slot.
            </Text>
          </VStack>

          <Button
            label={open ? "Close scheduler" : "Schedule clip"}
            variant={open ? "secondary" : "primary"}
            size="sm"
            isLoading={loading}
            isDisabled={busy}
            icon={<Icon icon={PlusGlyph} />}
            onClick={() => void toggleScheduler()}
          />
        </HStack>

        {open ? (
          <form onSubmit={submit}>
            <VStack gap={4}>
              <Divider />

              <Selector
                label="Finished library clip"
                placeholder={
                  loading
                    ? "Loading library…"
                    : options.length
                      ? "Choose a kept clip…"
                      : "No finished kept clips found"
                }
                value={jobClip}
                onChange={setJobClip}
                isLoading={loading}
                isDisabled={busy || !options.length}
                hasSearch={options.length > 6}
                options={options.map((o) => ({ value: o.value, label: o.label }))}
                width="100%"
              />

              <Grid columns={{ minWidth: 220, max: 2 }} gap={4} align="start">
                <Selector
                  label="Target platform"
                  value={platform}
                  onChange={(v) => setPlatform(v as Platform | "both")}
                  isDisabled={busy}
                  options={[
                    { value: "youtube", label: "YouTube Shorts" },
                    { value: "instagram", label: "Instagram Reels" },
                    { value: "both", label: "Both platforms" },
                  ]}
                  width="100%"
                />

                <DateTimeInput
                  label="Publish date & time (local)"
                  value={scheduledAt as ISODateTimeString}
                  onChange={(val) => setScheduledAt(val ?? "")}
                  isDisabled={busy}
                  isRequired
                  width="100%"
                />
              </Grid>

              {busy ? (
                <ProgressBar
                  label={stage || "Scheduling clip…"}
                  isIndeterminate
                  variant="accent"
                />
              ) : null}

              {error ? (
                <Banner
                  status="error"
                  title="Scheduling error"
                  description={error}
                  isDismissable
                  onDismiss={() => setError("")}
                />
              ) : null}

              <HStack justify="between" align="center" wrap="wrap" gap={3}>
                <Text type="supporting" color="secondary">
                  The MP4 upload finishes before the queue entry is recorded.
                </Text>
                <Button
                  type="submit"
                  label={busy ? "Uploading & scheduling…" : "Upload & schedule"}
                  variant="primary"
                  isLoading={busy}
                  isDisabled={loading || !options.length}
                />
              </HStack>
            </VStack>
          </form>
        ) : null}
      </VStack>
    </Card>
  );
}
