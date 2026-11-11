"use client";

import { useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { List, ListItem } from "@astryxdesign/core/List";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Switch } from "@astryxdesign/core/Switch";
import { useToast } from "@astryxdesign/core/Toast";
import { Text } from "@astryxdesign/core/Text";
import { FilmGlyph, MusicGlyph, PlusGlyph, TrashGlyph } from "@/components/StudioIcons";
import { createJob, uploadSoundtrack, uploadVideo } from "@/lib/api";
import { CAPTION_STYLE_OPTIONS } from "@/lib/captionStyles";
import type { Layout, Provider } from "@/lib/types";

type QueueStatus = "pending" | "uploading" | "created" | "error";

type QueueEntry = {
  id: string;
  file: File;
  status: QueueStatus;
  jobId?: string;
  error?: string;
};

const MAX_SOUNDTRACK_BYTES = 100 * 1024 * 1024;
const VIDEO_EXT = /\.(mp4|mov|mkv|webm|m4v|avi)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;

function isVideoFile(file: File) {
  return file.type.startsWith("video/") || VIDEO_EXT.test(file.name);
}

function isAudioFile(file: File) {
  return file.type.startsWith("audio/") || AUDIO_EXT.test(file.name);
}

function formatSizeMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BulkCutUploader({ onCreated }: { onCreated: () => void }) {
  const toast = useToast();

  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [rawFiles, setRawFiles] = useState<File[]>([]);
  const [soundtrackFile, setSoundtrackFile] = useState<File | null>(null);
  const [soundtrackError, setSoundtrackError] = useState("");

  const [clipCount, setClipCount] = useState(5);
  const [provider, setProvider] = useState<Provider>("local");
  const [layout, setLayout] = useState<Layout>("fill");
  const [captionStyle, setCaptionStyle] = useState(CAPTION_STYLE_OPTIONS[0].key);
  const [loudnorm, setLoudnorm] = useState(true);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  function handleVideoFilesChange(files: File | File[] | null) {
    const list = Array.isArray(files) ? files : files ? [files] : [];
    const valid = list.filter(isVideoFile);
    if (list.length > valid.length) {
      setError("Skipped non-video files. Supported formats: MP4, MOV, MKV, WebM, M4V, AVI.");
    } else {
      setError("");
    }
    setRawFiles(valid);
    setEntries((prev) => {
      const byName = new Map(prev.map((e) => [`${e.file.name}:${e.file.size}`, e]));
      return valid.map((file, i) => {
        const key = `${file.name}:${file.size}`;
        return (
          byName.get(key) ?? {
            id: `${file.name}-${file.size}-${i}`,
            file,
            status: "pending",
          }
        );
      });
    });
  }

  function handleSoundtrackChange(files: File | File[] | null) {
    const file = Array.isArray(files) ? (files[0] ?? null) : files;
    if (!file) {
      setSoundtrackFile(null);
      setSoundtrackError("");
      return;
    }
    if (!isAudioFile(file)) {
      setSoundtrackError("Unsupported audio format. Use MP3, WAV, M4A, AAC, OGG, or FLAC.");
      setSoundtrackFile(null);
      return;
    }
    if (file.size > MAX_SOUNDTRACK_BYTES) {
      setSoundtrackError("Audio file exceeds the 100 MB limit.");
      setSoundtrackFile(null);
      return;
    }
    setSoundtrackError("");
    setSoundtrackFile(file);
  }

  async function startBatch() {
    const pending = entries.filter((e) => e.status === "pending" || e.status === "error");
    if (pending.length === 0 || running) return;

    setRunning(true);
    setError("");

    let sharedSoundtrackPath: string | undefined;
    if (soundtrackFile) {
      try {
        const up = await uploadSoundtrack(soundtrackFile);
        sharedSoundtrackPath = up.path;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not upload shared soundtrack.",
        );
        setRunning(false);
        return;
      }
    }

    let createdCount = 0;

    for (const item of pending) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === item.id ? { ...e, status: "uploading", error: undefined } : e,
        ),
      );

      try {
        const uploaded = await uploadVideo(item.file);
        const job = await createJob({
          sourceUrl: uploaded.path,
          clipCount,
          provider,
          vertical: true,
          captions: true,
          captionStyle,
          layout,
          loudnorm,
          soundtrackPath: sharedSoundtrackPath,
          soundtrackVolume: 0.18,
        });
        createdCount += 1;
        setEntries((prev) =>
          prev.map((e) =>
            e.id === item.id ? { ...e, status: "created", jobId: job.id } : e,
          ),
        );
        onCreated();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed.";
        setEntries((prev) =>
          prev.map((e) =>
            e.id === item.id ? { ...e, status: "error", error: msg } : e,
          ),
        );
      }
    }

    setRunning(false);
    if (createdCount > 0) {
      toast({
        body: `Queued ${createdCount} ${createdCount === 1 ? "project" : "projects"} from batch.`,
        uniqueID: "batch-queued",
      });
    }
  }

  function clearQueue() {
    if (running) return;
    setEntries([]);
    setRawFiles([]);
    setSoundtrackFile(null);
    setError("");
    setSoundtrackError("");
  }

  const completedCount = entries.filter((e) => e.status === "created").length;
  const pendingCount = entries.filter((e) => e.status === "pending" || e.status === "error").length;

  return (
    <VStack gap={5}>
      {error ? (
        <Banner
          status="error"
          title="Batch import warning"
          description={error}
          isDismissable
          onDismiss={() => setError("")}
        />
      ) : null}

      <Grid columns={{ minWidth: 260, max: 2 }} gap={4} align="start">
        <FileInput
          label="Source videos"
          description="Select multiple video files to upload and enqueue sequentially."
          mode="dropzone"
          isMultiple
          accept="video/*,.mp4,.mov,.mkv,.webm,.m4v,.avi"
          value={rawFiles}
          onChange={handleVideoFilesChange}
          isDisabled={running}
          placeholder="Drop multiple videos here or browse"
        />

        <FileInput
          label="Shared soundtrack (optional)"
          description="Mixed under dialogue across every video in this batch (max 100 MB)."
          mode="dropzone"
          accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
          maxSize={MAX_SOUNDTRACK_BYTES}
          value={soundtrackFile}
          onChange={handleSoundtrackChange}
          isDisabled={running}
          isOptional
          placeholder="Drop shared background track"
          status={soundtrackError ? { type: "error", message: soundtrackError } : undefined}
          statusVariant="detached"
        />
      </Grid>

      <Grid columns={{ minWidth: 160, max: 4 }} gap={3} align="end">
        <NumberInput
          label="Clips per video"
          value={clipCount}
          onChange={(v) => setClipCount(Math.max(1, Math.min(10, Math.round(v || 1))))}
          min={1}
          max={10}
          isIntegerOnly
          hasNumberSteppers
          isDisabled={running}
          width="100%"
        />

        <Selector
          label="AI provider"
          value={provider}
          onChange={(v) => setProvider(v as Provider)}
          isDisabled={running}
          options={[
            { value: "local", label: "Local" },
            { value: "groq", label: "Groq" },
            { value: "openrouter", label: "OpenRouter" },
          ]}
          width="100%"
        />

        <Selector
          label="Crop layout"
          value={layout}
          onChange={(v) => setLayout(v as Layout)}
          isDisabled={running}
          options={[
            { value: "fill", label: "Fill 9:16" },
            { value: "fit_blur", label: "Fit + blur" },
            { value: "split_screen", label: "Split screen" },
          ]}
          width="100%"
        />

        <Selector
          label="Caption preset"
          value={captionStyle}
          onChange={(v) => setCaptionStyle(v)}
          isDisabled={running}
          options={CAPTION_STYLE_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
          width="100%"
        />
      </Grid>

      <HStack justify="between" align="center" wrap="wrap" gap={3}>
        <Switch
          label="Normalize loudness (-14 LUFS)"
          value={loudnorm}
          onChange={setLoudnorm}
          isDisabled={running}
        />

        <HStack gap={2} align="center">
          {entries.length > 0 ? (
            <Button
              label="Clear queue"
              variant="ghost"
              size="sm"
              isDisabled={running}
              icon={<Icon icon={TrashGlyph} />}
              onClick={clearQueue}
            />
          ) : null}
          <Button
            label={
              running
                ? `Uploading (${completedCount}/${entries.length})…`
                : `Launch ${pendingCount || 0} ${pendingCount === 1 ? "project" : "projects"}`
            }
            variant="primary"
            size="sm"
            isLoading={running}
            isDisabled={pendingCount === 0}
            icon={<Icon icon={PlusGlyph} />}
            onClick={() => void startBatch()}
          />
        </HStack>
      </HStack>

      {entries.length > 0 ? (
        <VStack gap={3}>
          <Divider label={`Batch queue (${completedCount}/${entries.length} queued)`} />
          {running ? (
            <ProgressBar
              label="Batch upload progress"
              isLabelHidden
              value={completedCount}
              max={entries.length}
              variant="accent"
            />
          ) : null}

          <Card padding={2} variant="muted">
            <List hasDividers density="compact">
              {entries.map((entry) => (
                <ListItem
                  key={entry.id}
                  startContent={
                    <StatusDot
                      variant={
                        entry.status === "created"
                          ? "success"
                          : entry.status === "error"
                            ? "error"
                            : entry.status === "uploading"
                              ? "warning"
                              : "neutral"
                      }
                      label={entry.status}
                    />
                  }
                  label={entry.file.name}
                  description={
                    entry.error
                      ? entry.error
                      : `${formatSizeMb(entry.file.size)} · ${
                          entry.status === "uploading"
                            ? "Uploading & creating job…"
                            : entry.status === "created"
                              ? "Job launched"
                              : "Queued locally"
                        }`
                  }
                  endContent={
                    entry.jobId ? (
                      <Button
                        label="Open studio"
                        href={`/jobs/${entry.jobId}`}
                        variant="secondary"
                        size="sm"
                        icon={<Icon icon={FilmGlyph} />}
                      />
                    ) : (
                      <Badge
                        label={entry.status}
                        variant={
                          entry.status === "error"
                            ? "error"
                            : entry.status === "uploading"
                              ? "info"
                              : "neutral"
                        }
                      />
                    )
                  }
                />
              ))}
            </List>
          </Card>

          {soundtrackFile ? (
            <HStack gap={2} align="center">
              <Icon icon={MusicGlyph} size="sm" color="accent" />
              <Text type="supporting" color="secondary">
                Shared soundtrack: {soundtrackFile.name} ({formatSizeMb(soundtrackFile.size)})
              </Text>
            </HStack>
          ) : null}
        </VStack>
      ) : null}
    </VStack>
  );
}
