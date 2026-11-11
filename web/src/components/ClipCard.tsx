"use client";

import { memo, useEffect, useRef, useState, type FormEvent } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { DateTimeInput, type ISODateTimeString } from "@astryxdesign/core/DateTimeInput";
import { Divider } from "@astryxdesign/core/Divider";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import {
  FilmGlyph,
  PlayGlyph,
  RefreshGlyph,
  SlidersGlyph,
  SparklesGlyph,
} from "@/components/StudioIcons";
import {
  fetchClipAnalytics,
  fetchClipPublishStatus,
  patchClip,
  publishClip,
  scheduleClip,
  selectTitleVariant,
} from "@/lib/api";
import { CAPTION_STYLE_OPTIONS } from "@/lib/captionStyles";
import { normalizeTitleVariants } from "@/lib/titleVariants";
import type { Clip, Platform, SocialTemplate } from "@/lib/types";

type ClipCardProps = {
  jobId: string;
  clip: Clip;
  busy: boolean;
  captionsEnabled: boolean;
  onKeep: (kept: boolean) => void;
  onTimes: (start: number, end: number) => void;
  onRerender: (
    start: number,
    end: number,
    captionStyle: string,
    template: SocialTemplate,
    templateDisplayName: string,
    templateHandle: string,
  ) => Promise<void>;
};

type ClipTab = "trim" | "copy" | "publish";

function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.0";
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1).padStart(4, "0");
  return `${mins}:${secs}`;
}

function defaultScheduleIso(): string {
  const d = new Date(Date.now() + 2 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function CaptionPreviewSwatch({ styleKey }: { styleKey: string }) {
  const option = CAPTION_STYLE_OPTIONS.find((o) => o.key === styleKey) || CAPTION_STYLE_OPTIONS[0];
  const words = styleKey === "one_word" ? ["THIS"] : ["MAKE", "IT", "COUNT"];

  return (
    <svg
      viewBox="0 0 260 56"
      role="img"
      aria-label={`Illustrative caption preview: ${option.label}`}
      className="h-14 w-full rounded-lg bg-body"
    >
      <rect x="1" y="1" width="258" height="54" rx="8" fill="#090b12" stroke="rgba(255,255,255,0.14)" />
      {words.length === 1 ? (
        <text
          x="130"
          y="36"
          textAnchor="middle"
          fill={option.active}
          stroke={option.stroke}
          strokeWidth="3"
          paintOrder="stroke"
          fontSize="20"
          fontWeight="900"
        >
          {option.upper ? words[0] : words[0].toLowerCase()}
        </text>
      ) : (
        <g>
          {option.activeBg ? (
            <rect x="106" y="14" width="48" height="26" rx="4" fill={option.activeBg} />
          ) : null}
          <text
            x="68"
            y="34"
            textAnchor="middle"
            fill={option.base}
            stroke={option.stroke}
            strokeWidth="2.5"
            paintOrder="stroke"
            fontSize="15"
            fontWeight="800"
          >
            {option.upper ? words[0] : words[0].toLowerCase()}
          </text>
          <text
            x="130"
            y="34"
            textAnchor="middle"
            fill={option.active}
            stroke={option.activeBg ? "none" : option.stroke}
            strokeWidth="2.5"
            paintOrder="stroke"
            fontSize="15"
            fontWeight="800"
          >
            {option.upper ? words[1] : words[1].toLowerCase()}
          </text>
          <text
            x="194"
            y="34"
            textAnchor="middle"
            fill={option.base}
            stroke={option.stroke}
            strokeWidth="2.5"
            paintOrder="stroke"
            fontSize="15"
            fontWeight="800"
          >
            {option.upper ? words[2] : words[2].toLowerCase()}
          </text>
        </g>
      )}
    </svg>
  );
}

function ClipCardView({
  jobId,
  clip,
  busy,
  captionsEnabled,
  onKeep,
  onTimes,
  onRerender,
}: ClipCardProps) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<ClipTab>("trim");

  const [start, setStart] = useState(clip.start);
  const [end, setEnd] = useState(clip.end);
  const [timeError, setTimeError] = useState("");
  const [captionStyle, setCaptionStyle] = useState(clip.captionStyle || CAPTION_STYLE_OPTIONS[0].key);
  const [template, setTemplate] = useState<SocialTemplate>(clip.template || "none");
  const [templateDisplayName, setTemplateDisplayName] = useState(
    clip.templateDisplayName || "Your Name",
  );
  const [templateHandle, setTemplateHandle] = useState(clip.templateHandle || "@yourhandle");

  const [previewTab, setPreviewTab] = useState<"video" | "cover">("video");
  const [hasVideo, setHasVideo] = useState(true);
  const [hasCover, setHasCover] = useState(true);
  const [videoKey, setVideoKey] = useState(0);
  const [rerendering, setRerendering] = useState(false);
  const [rerenderMessage, setRerenderMessage] = useState("");

  const [activeTitle, setActiveTitle] = useState(clip.title);
  const [selectedVariantId, setSelectedVariantId] = useState(clip.selectedTitleVariant || "");
  const [savingTitle, setSavingTitle] = useState(false);
  const titleVariants = normalizeTitleVariants(clip.titleVariants);

  const [showMetadataEditor, setShowMetadataEditor] = useState(false);
  const [metadataTitle, setMetadataTitle] = useState(clip.seo?.youtube?.title || clip.title || "");
  const [metadataDescription, setMetadataDescription] = useState(
    clip.seo?.youtube?.description || "",
  );
  const [metadataCaption, setMetadataCaption] = useState(clip.seo?.instagram?.caption || "");
  const [metadataHashtags, setMetadataHashtags] = useState((clip.seo?.hashtags || []).join(" "));
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [metadataMessage, setMetadataMessage] = useState("");

  const [publishPrivacy, setPublishPrivacy] = useState<"private" | "unlisted" | "public">("private");
  const [publishing, setPublishing] = useState<Platform | "both" | null>(null);
  const [publishProgress, setPublishProgress] = useState(0);
  const [publishStatusText, setPublishStatusText] = useState("");
  const [publishState, setPublishState] = useState(clip.publish || {});
  const [publishError, setPublishError] = useState("");
  const publishPollTimer = useRef<number | null>(null);

  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [schedulePlatform, setSchedulePlatform] = useState<Platform | "both">("youtube");
  const [scheduleTime, setScheduleTime] = useState<string>(defaultScheduleIso);
  const [scheduling, setScheduling] = useState(false);
  const [scheduleState, setScheduleState] = useState(clip.schedule);

  const [analytics, setAnalytics] = useState(clip.analytics);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  const [prevClip, setPrevClip] = useState(clip);
  if (clip !== prevClip) {
    setPrevClip(clip);
    setStart(clip.start);
    setEnd(clip.end);
    setCaptionStyle(clip.captionStyle || CAPTION_STYLE_OPTIONS[0].key);
    setTemplate(clip.template || "none");
    setTemplateDisplayName(clip.templateDisplayName || "Your Name");
    setTemplateHandle(clip.templateHandle || "@yourhandle");
    setActiveTitle(clip.title);
    setSelectedVariantId(clip.selectedTitleVariant || "");
    setMetadataTitle(clip.seo?.youtube?.title || clip.title || "");
    setMetadataDescription(clip.seo?.youtube?.description || "");
    setMetadataCaption(clip.seo?.instagram?.caption || "");
    setMetadataHashtags((clip.seo?.hashtags || []).join(" "));
    setPublishState(clip.publish || {});
    setScheduleState(clip.schedule);
    setAnalytics(clip.analytics);
  }

  useEffect(() => {
    return () => {
      if (publishPollTimer.current !== null) {
        window.clearInterval(publishPollTimer.current);
      }
    };
  }, []);

  function validateTimes(nextStart = start, nextEnd = end) {
    if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd) || nextStart < 0) {
      setTimeError("Enter valid non-negative start and end times.");
      return false;
    }
    if (nextEnd <= nextStart) {
      setTimeError("End time must be greater than start time.");
      return false;
    }
    setTimeError("");
    return true;
  }

  function commitTimes(nextStart = start, nextEnd = end) {
    if (!validateTimes(nextStart, nextEnd)) return false;
    if (nextStart !== clip.start || nextEnd !== clip.end) {
      onTimes(nextStart, nextEnd);
    }
    return true;
  }

  async function handleRerenderClick() {
    if (!validateTimes()) return;
    setRerendering(true);
    setRerenderMessage("Re-rendering clip with updated settings…");
    try {
      await onRerender(
        start,
        end,
        captionStyle,
        template,
        templateDisplayName.trim() || "Your Name",
        templateHandle.trim() || "@yourhandle",
      );
      setVideoKey((k) => k + 1);
      setHasVideo(true);
      setHasCover(true);
      setRerenderMessage("Re-render complete.");
      toast({ body: `Re-rendered "${activeTitle}"`, uniqueID: `rerender-${clip.id}` });
    } catch (err) {
      setRerenderMessage(err instanceof Error ? err.message : "Re-render failed.");
    } finally {
      setRerendering(false);
    }
  }

  async function handleSelectVariant(variantId: string) {
    setSelectedVariantId(variantId);
    setSavingTitle(true);
    try {
      const res = await selectTitleVariant(jobId, clip.id, variantId);
      const updated = res.clips.find((item) => item.id === clip.id);
      setActiveTitle(updated?.title ?? clip.title);
      setMetadataTitle(updated?.title ?? clip.title);
      setSelectedVariantId(updated?.selectedTitleVariant ?? variantId);
      toast({ body: "Active title variant updated.", uniqueID: `variant-${clip.id}` });
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Failed to select title variant.");
    } finally {
      setSavingTitle(false);
    }
  }

  async function handleSaveMetadata(e: FormEvent) {
    e.preventDefault();
    setSavingMetadata(true);
    setMetadataMessage("");
    const hashtags = metadataHashtags
      .split(/[\s,]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
    try {
      await patchClip(jobId, clip.id, {
        title: metadataTitle.trim(),
        description: metadataDescription,
        caption: metadataCaption,
        hashtags,
      });
      setActiveTitle(metadataTitle.trim());
      setMetadataHashtags(hashtags.join(" "));
      setMetadataMessage("Publishing copy saved.");
      setShowMetadataEditor(false);
      toast({ body: "Clip publishing copy saved.", uniqueID: `meta-${clip.id}` });
    } catch (err) {
      setMetadataMessage(err instanceof Error ? err.message : "Could not save clip details.");
    } finally {
      setSavingMetadata(false);
    }
  }

  async function handleScheduleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!scheduleTime) return;
    setScheduling(true);
    try {
      const scheduledUtc = new Date(scheduleTime).toISOString();
      const res = await scheduleClip(jobId, clip.id, schedulePlatform, scheduledUtc);
      const updated = res.clips.find((item) => item.id === clip.id);
      setScheduleState(updated?.schedule);
      setShowScheduleForm(false);
      toast({ body: "Clip added to publishing queue.", uniqueID: `schedule-${clip.id}` });
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Scheduling failed.");
    } finally {
      setScheduling(false);
    }
  }

  async function handleRefreshAnalytics() {
    setLoadingAnalytics(true);
    try {
      const res = await fetchClipAnalytics(jobId, clip.id);
      const updated = res.clips.find((c) => c.id === clip.id);
      if (updated?.analytics) setAnalytics(updated.analytics);
      toast({ body: "Analytics refreshed.", uniqueID: `analytics-${clip.id}` });
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Failed to fetch analytics.");
    } finally {
      setLoadingAnalytics(false);
    }
  }

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ body: `${label} copied to clipboard.`, uniqueID: `copy-${clip.id}` });
    } catch {
      toast({ body: "Clipboard access denied.", type: "error", uniqueID: `copy-err-${clip.id}` });
    }
  }

  async function doPublish(target: Platform | "both", forceReauth = false) {
    setPublishError("");
    setPublishing(target);
    setPublishProgress(10);
    setPublishStatusText(
      forceReauth
        ? "Opening browser to connect YouTube Channel…"
        : "Preparing upload to platform API…",
    );

    let polling = false;
    const pollPublishState = async () => {
      if (polling || document.visibilityState !== "visible") return;
      polling = true;
      try {
        const snapshot = await fetchClipPublishStatus(jobId, clip.id);
        if (snapshot.analytics) setAnalytics(snapshot.analytics);
        if (snapshot.publish) {
          setPublishState((cur) =>
            JSON.stringify(cur) === JSON.stringify(snapshot.publish) ? cur : snapshot.publish!,
          );
          const pKey = target === "both" ? "youtube" : target;
          const platState = snapshot.publish[pKey];
          if (typeof platState?.progress === "number") {
            setPublishProgress(platState.progress);
            if (platState.status === "uploading") {
              setPublishStatusText(`Uploading chunks: ${platState.progress}%`);
            }
          }
        }
      } catch {
        /* polling is best-effort */
      } finally {
        polling = false;
      }
    };

    if (publishPollTimer.current !== null) window.clearInterval(publishPollTimer.current);
    void pollPublishState();
    publishPollTimer.current = window.setInterval(() => {
      void pollPublishState();
    }, 2500);

    try {
      const res = await publishClip(
        jobId,
        clip.id,
        target === "both" ? ["youtube", "instagram"] : [target],
        publishPrivacy,
        forceReauth,
      );
      const updated = res.clips.find((c) => c.id === clip.id);
      setPublishState(updated?.publish || {});
      setPublishProgress(100);
      setPublishStatusText("Upload complete.");
      if (updated?.analytics) setAnalytics(updated.analytics);
      toast({ body: `Published "${activeTitle}"`, uniqueID: `pub-${clip.id}` });
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Publish failed.");
      setPublishStatusText("");
    } finally {
      if (publishPollTimer.current !== null) {
        window.clearInterval(publishPollTimer.current);
        publishPollTimer.current = null;
      }
      window.setTimeout(() => {
        setPublishing(null);
        setPublishProgress(0);
        setPublishStatusText("");
      }, 1000);
    }
  }

  const videoSrc = `/api/jobs/${jobId}/clips/${clip.id}?v=${videoKey}`;
  const coverSrc = `/api/jobs/${jobId}/clips/${clip.id}?cover=1&v=${videoKey}`;
  const isYouTubePublished = publishState.youtube?.status === "published";
  const selectedCaptionOption =
    CAPTION_STYLE_OPTIONS.find((o) => o.key === captionStyle) || CAPTION_STYLE_OPTIONS[0];
  const timesChanged = start !== clip.start || end !== clip.end;
  const templateAuthorChanged =
    (template === "x" || template === "instagram") &&
    ((clip.templateDisplayName || "Your Name") !== templateDisplayName ||
      (clip.templateHandle || "@yourhandle") !== templateHandle);
  const needsRerender =
    clip.captionStyle !== captionStyle ||
    (clip.template || "none") !== template ||
    timesChanged ||
    templateAuthorChanged;
  const effectiveTab: ClipTab =
    activeTab === "publish" && (!hasVideo || !clip.seo) ? "trim" : activeTab;

  return (
    <Card padding={5} variant={clip.kept ? "default" : "muted"}>
      <VStack gap={4}>
        {/* Header */}
        <HStack justify="between" align="start" gap={3}>
          <VStack gap={1}>
            <HStack gap={2} align="center" wrap="wrap">
              <StatusDot
                variant={clip.kept ? "success" : "neutral"}
                label={clip.kept ? "Kept" : "Dropped"}
              />
              <Text type="supporting" size="2xs" weight="semibold" color={clip.kept ? "primary" : "secondary"}>
                {clip.kept ? "Kept" : "Dropped"}
              </Text>
              <Badge
                label={`Score ${clip.score}`}
                variant={clip.score >= 80 ? "success" : clip.score >= 60 ? "info" : "neutral"}
              />
              {savingTitle ? <Badge label="Saving…" variant="warning" /> : null}
            </HStack>
            <Heading level={3} type="display-3">
              {activeTitle}
            </Heading>
          </VStack>

          <Button
            label={clip.kept ? "Drop" : "Keep"}
            variant={clip.kept ? "secondary" : "primary"}
            size="sm"
            isDisabled={busy}
            onClick={() => onKeep(!clip.kept)}
          />
        </HStack>

        {/* Signals / Retention Summary */}
        <HStack gap={2} align="center" wrap="wrap">
          {clip.hook ? <Badge label={`Hook: "${clip.hook}"`} variant="info" /> : null}
          <Text type="code" size="2xs" color="secondary">
            {[
              clip.captionStyle,
              clip.hookOverlay !== false ? "Hook overlay" : null,
              clip.loudnorm !== false ? "-14 LUFS" : null,
              clip.progressBar ? "Progress bar" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </HStack>

        {/* Preview + Reason + Transcript */}
        <Grid columns={{ minWidth: 200, max: 2 }} gap={4} align="start">
          <VStack gap={2} align="center">
            {hasVideo && hasCover ? (
              <SegmentedControl
                label="Preview mode"
                value={previewTab}
                onChange={(val) => setPreviewTab(val as "video" | "cover")}
                size="sm"
                layout="fill"
              >
                <SegmentedControlItem value="video" label="Video" />
                <SegmentedControlItem value="cover" label="Cover" />
              </SegmentedControl>
            ) : null}

            {previewTab === "cover" && hasCover ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={coverSrc}
                alt={`Cover frame for ${activeTitle}`}
                loading="lazy"
                decoding="async"
                className="aspect-[9/16] max-h-72 w-40 rounded-lg border border-border object-cover"
                onError={() => setHasCover(false)}
              />
            ) : hasVideo ? (
              <video
                key={videoKey}
                controls
                playsInline
                preload="none"
                src={videoSrc}
                className="aspect-[9/16] max-h-72 w-40 rounded-lg border border-border bg-body object-cover"
                onError={() => setHasVideo(false)}
              />
            ) : (
              <Card padding={4} variant="muted" width={160}>
                <VStack gap={3}>
                  <Icon icon={FilmGlyph} size="md" />
                  <Text type="supporting" weight="semibold">
                    9:16 Preview unavailable
                  </Text>
                  <Text type="code" color="secondary">
                    {formatTimecode(clip.start)} – {formatTimecode(clip.end)}
                  </Text>
                </VStack>
              </Card>
            )}
          </VStack>

          <VStack gap={3}>
            <VStack gap={1}>
              <Text type="label" color="accent">
                WHY THIS MOMENT WORKS
              </Text>
              <Text type="body">{clip.reason}</Text>
            </VStack>
            <Card padding={3} variant="muted">
              <Text type="supporting" color="secondary">
                {clip.text}
              </Text>
            </Card>
          </VStack>
        </Grid>

        <Divider />

        {/* Sub-workbench Tabs */}
        <TabList
          value={effectiveTab}
          onChange={(val) => setActiveTab(val as ClipTab)}
          aria-label="Clip workbench tools"
          size="sm"
          hasDivider
        >
          <Tab value="trim" label="Trim & Style" icon={<Icon icon={SlidersGlyph} />} />
          <Tab value="copy" label="Copy & A/B" icon={<Icon icon={SparklesGlyph} />} />
          {hasVideo && clip.seo ? (
            <Tab value="publish" label="Publish" icon={<Icon icon={PlayGlyph} />} />
          ) : null}
        </TabList>

        {/* Tab 1: Trim & Style */}
        {effectiveTab === "trim" ? (
          <VStack gap={4}>
            <Grid columns={{ minWidth: 140, max: 2 }} gap={3}>
              <NumberInput
                label="Start (sec)"
                description={formatTimecode(start)}
                value={start}
                onChange={(val) => setStart(Number.isFinite(val) ? val : 0)}
                min={0}
                step={0.1}
                isDisabled={rerendering}
                width="100%"
              />
              <NumberInput
                label="End (sec)"
                description={formatTimecode(end)}
                value={end}
                onChange={(val) => setEnd(Number.isFinite(val) ? val : 0)}
                min={0}
                step={0.1}
                isDisabled={rerendering}
                width="100%"
              />
            </Grid>

            {timeError ? <Banner status="error" title={timeError} /> : null}

            <Selector
              label="Social template"
              value={template}
              onChange={(val) => setTemplate(val as SocialTemplate)}
              isDisabled={rerendering || busy}
              options={[
                { value: "none", label: "Clean 9:16" },
                { value: "x", label: "Twitter / X post" },
                { value: "instagram", label: "Instagram Reel" },
                { value: "headline", label: "Viral headline" },
              ]}
              width="100%"
            />

            {template === "x" || template === "instagram" ? (
              <Grid columns={{ minWidth: 150, max: 2 }} gap={3}>
                <TextInput
                  label="Display name"
                  value={templateDisplayName}
                  onChange={(val) => setTemplateDisplayName(val.slice(0, 40))}
                  isDisabled={rerendering || busy}
                  width="100%"
                />
                <TextInput
                  label="Handle"
                  value={templateHandle}
                  onChange={(val) => {
                    const cleaned = val.replace(/\s+/g, "").slice(0, 32);
                    setTemplateHandle(
                      cleaned && !cleaned.startsWith("@") ? `@${cleaned.replace(/^@+/, "")}` : cleaned,
                    );
                  }}
                  isDisabled={rerendering || busy}
                  width="100%"
                />
              </Grid>
            ) : null}

            {captionsEnabled ? (
              <VStack gap={3}>
                <Selector
                  label="Caption preset"
                  description={selectedCaptionOption.description}
                  value={captionStyle}
                  onChange={(val) => setCaptionStyle(val)}
                  isDisabled={rerendering || busy}
                  options={CAPTION_STYLE_OPTIONS.map((opt) => ({
                    value: opt.key,
                    label: opt.label,
                  }))}
                  width="100%"
                />
                <CaptionPreviewSwatch styleKey={captionStyle} />
              </VStack>
            ) : null}

            <HStack gap={3} align="center" wrap="wrap">
              <Button
                label={
                  rerendering
                    ? "Re-rendering…"
                    : needsRerender
                      ? "Apply & re-render"
                      : "Re-render clip"
                }
                variant={needsRerender ? "primary" : "secondary"}
                size="sm"
                isLoading={rerendering}
                isDisabled={busy}
                icon={<Icon icon={RefreshGlyph} />}
                onClick={handleRerenderClick}
              />
              {timesChanged ? (
                <Button
                  label="Save trim"
                  variant="ghost"
                  size="sm"
                  isDisabled={busy || rerendering}
                  onClick={() => {
                    if (commitTimes()) {
                      toast({ body: "Trim timestamps saved.", uniqueID: `trim-${clip.id}` });
                    }
                  }}
                />
              ) : null}
              {rerenderMessage ? (
                <Text type="supporting" color="accent">
                  {rerenderMessage}
                </Text>
              ) : null}
            </HStack>
          </VStack>
        ) : null}

        {/* Tab 2: Copy & A/B Title Variants */}
        {effectiveTab === "copy" ? (
          <VStack gap={4}>
            {titleVariants.length > 0 ? (
              <RadioList
                label="Title A/B variants"
                description="Select the hook title used for publishing."
                value={selectedVariantId}
                onChange={(val) => void handleSelectVariant(val)}
                width="100%"
              >
                {titleVariants.map((v) => (
                  <RadioListItem
                    key={v.id}
                    value={v.id}
                    label={v.title}
                    description={v.label || v.angle || v.id}
                    endContent={
                      selectedVariantId === v.id ? (
                        <Badge label="Active" variant="info" />
                      ) : undefined
                    }
                  />
                ))}
              </RadioList>
            ) : null}

            <Card padding={4} variant="muted">
              <VStack gap={3}>
                <HStack justify="between" align="center">
                  <Text type="label">PUBLISHING COPY</Text>
                  <Button
                    label={showMetadataEditor ? "Close editor" : "Edit copy"}
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowMetadataEditor((o) => !o)}
                  />
                </HStack>

                <Text type="body" weight="semibold">
                  {metadataTitle || "No title set"}
                </Text>
                {metadataDescription ? (
                  <Text type="supporting" color="secondary">
                    {metadataDescription}
                  </Text>
                ) : null}
                {metadataCaption ? (
                  <Text type="supporting">{metadataCaption}</Text>
                ) : null}
                {metadataHashtags ? (
                  <Text type="code" color="accent">
                    {metadataHashtags}
                  </Text>
                ) : null}

                <HStack gap={2} wrap="wrap">
                  <Button
                    label="Copy YouTube text"
                    variant="secondary"
                    size="sm"
                    isDisabled={!metadataTitle.trim() && !metadataDescription.trim()}
                    onClick={() => void copyText("YouTube text", `${metadataTitle}\n\n${metadataDescription}`)}
                  />
                  <Button
                    label="Copy Instagram caption"
                    variant="secondary"
                    size="sm"
                    isDisabled={!metadataCaption.trim() && !metadataHashtags.trim()}
                    onClick={() =>
                      void copyText(
                        "Instagram caption",
                        [metadataCaption, metadataHashtags].filter(Boolean).join("\n\n"),
                      )
                    }
                  />
                </HStack>

                {showMetadataEditor ? (
                  <form onSubmit={handleSaveMetadata}>
                    <VStack gap={3} paddingBlockStart={3}>
                      <Divider />
                      <TextInput
                        label="Clip title"
                        value={metadataTitle}
                        onChange={(v) => setMetadataTitle(v.slice(0, 100))}
                        width="100%"
                      />
                      <TextArea
                        label="YouTube description"
                        value={metadataDescription}
                        rows={3}
                        maxLength={5000}
                        onChange={setMetadataDescription}
                        width="100%"
                      />
                      <TextArea
                        label="Instagram / Reels caption"
                        value={metadataCaption}
                        rows={3}
                        maxLength={2200}
                        onChange={setMetadataCaption}
                        width="100%"
                      />
                      <TextArea
                        label="Hashtags"
                        description="Space or comma separated"
                        value={metadataHashtags}
                        rows={2}
                        onChange={setMetadataHashtags}
                        width="100%"
                      />
                      <HStack gap={2}>
                        <Button
                          type="submit"
                          label={savingMetadata ? "Saving…" : "Save copy"}
                          variant="primary"
                          size="sm"
                          isLoading={savingMetadata}
                        />
                        <Button
                          label="Cancel"
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowMetadataEditor(false)}
                        />
                      </HStack>
                    </VStack>
                  </form>
                ) : null}

                {metadataMessage ? (
                  <Text type="supporting" color="accent">
                    {metadataMessage}
                  </Text>
                ) : null}
              </VStack>
            </Card>
          </VStack>
        ) : null}

        {/* Tab 3: Publish & Schedule */}
        {effectiveTab === "publish" && hasVideo && clip.seo ? (
          <VStack gap={4}>
            <HStack justify="between" align="end" wrap="wrap" gap={3}>
              <Selector
                label="YouTube visibility"
                value={publishPrivacy}
                onChange={(v) => setPublishPrivacy(v as "private" | "unlisted" | "public")}
                options={[
                  { value: "private", label: "Private" },
                  { value: "unlisted", label: "Unlisted" },
                  { value: "public", label: "Public" },
                ]}
              />

              <Button
                label={showScheduleForm ? "Hide scheduler" : "Schedule post"}
                variant="secondary"
                size="sm"
                onClick={() => setShowScheduleForm((o) => !o)}
              />
            </HStack>

            <HStack gap={2} wrap="wrap">
              <Button
                label="YouTube Shorts"
                variant="primary"
                size="sm"
                isLoading={publishing === "youtube"}
                isDisabled={publishing !== null}
                onClick={() => void doPublish("youtube")}
              />
              <Button
                label="Instagram Reels"
                variant="secondary"
                size="sm"
                isLoading={publishing === "instagram"}
                isDisabled={publishing !== null}
                onClick={() => void doPublish("instagram")}
              />
              <Button
                label="Publish both"
                variant="secondary"
                size="sm"
                isLoading={publishing === "both"}
                isDisabled={publishing !== null}
                onClick={() => void doPublish("both")}
              />
            </HStack>

            {publishing !== null ? (
              <VStack gap={2}>
                <ProgressBar
                  label={publishStatusText || "Uploading clip…"}
                  value={Math.max(5, publishProgress)}
                  max={100}
                  hasValueLabel
                  variant="accent"
                />
              </VStack>
            ) : null}

            {showScheduleForm ? (
              <Card padding={4} variant="muted">
                <form onSubmit={handleScheduleSubmit}>
                  <VStack gap={3}>
                    <Text type="label" color="accent">
                      QUEUE SCHEDULER
                    </Text>
                    <Selector
                      label="Target platform"
                      value={schedulePlatform}
                      onChange={(v) => setSchedulePlatform(v as Platform | "both")}
                      options={[
                        { value: "youtube", label: "YouTube Shorts" },
                        { value: "instagram", label: "Instagram Reels" },
                        { value: "both", label: "Both platforms" },
                      ]}
                      width="100%"
                    />
                    <DateTimeInput
                      label="Publish date & time"
                      value={scheduleTime as ISODateTimeString}
                      onChange={(val) => setScheduleTime(val ?? "")}
                      isRequired
                      width="100%"
                    />
                    <Button
                      type="submit"
                      label={scheduling ? "Scheduling…" : "Confirm schedule"}
                      variant="primary"
                      size="sm"
                      isLoading={scheduling}
                    />
                  </VStack>
                </form>
              </Card>
            ) : null}

            {scheduleState ? (
              <Banner
                status="info"
                title={`Scheduled (${scheduleState.status})`}
                description={new Date(
                  scheduleState.scheduled_at || scheduleState.publishAt || scheduleState.published_at || "",
                ).toLocaleString()}
              />
            ) : null}

            {(["youtube", "instagram"] as const).map((plat) => {
              const r = publishState[plat];
              if (!r) return null;
              if (r.status === "published") {
                return (
                  <Banner
                    key={plat}
                    status="success"
                    title={`${plat === "youtube" ? "YouTube Shorts" : "Instagram Reels"} published`}
                    endContent={
                      r.url ? (
                        <Button
                          label="Open post"
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          variant="secondary"
                          size="sm"
                        />
                      ) : undefined
                    }
                  />
                );
              }
              return (
                <Banner
                  key={plat}
                  status="error"
                  title={`${plat === "youtube" ? "YouTube Shorts" : "Instagram Reels"} notice`}
                  description={r.error}
                  endContent={
                    plat === "youtube" ? (
                      <Button
                        label="Re-auth Google"
                        variant="secondary"
                        size="sm"
                        isDisabled={publishing !== null}
                        onClick={() => void doPublish("youtube", true)}
                      />
                    ) : undefined
                  }
                />
              );
            })}

            {publishError ? <Banner status="error" title="Publish failed" description={publishError} /> : null}

            {isYouTubePublished || analytics ? (
              <Card padding={4} variant="muted">
                <VStack gap={3}>
                  <HStack justify="between" align="center">
                    <Text type="label">YOUTUBE ANALYTICS</Text>
                    <Button
                      label="Refresh"
                      variant="ghost"
                      size="sm"
                      isLoading={loadingAnalytics}
                      icon={<Icon icon={RefreshGlyph} />}
                      onClick={handleRefreshAnalytics}
                    />
                  </HStack>
                  <MetadataList title="Clip performance" orientation="horizontal" label={{ position: "top" }}>
                    <MetadataListItem label="Views">
                      <Text type="supporting">
                        {String(analytics?.view_count ?? analytics?.views ?? 0)}
                      </Text>
                    </MetadataListItem>
                    <MetadataListItem label="Likes">
                      <Text type="supporting">
                        {String(analytics?.like_count ?? analytics?.likes ?? 0)}
                      </Text>
                    </MetadataListItem>
                    <MetadataListItem label="Comments">
                      <Text type="supporting">
                        {String(analytics?.comment_count ?? analytics?.comments ?? 0)}
                      </Text>
                    </MetadataListItem>
                    {analytics?.retention_seconds || analytics?.retentionSeconds ? (
                      <MetadataListItem label="Avg retention">
                        <Text type="supporting">
                          {`${analytics.retention_seconds ?? analytics.retentionSeconds}s`}
                        </Text>
                      </MetadataListItem>
                    ) : null}
                  </MetadataList>
                </VStack>
              </Card>
            ) : null}
          </VStack>
        ) : null}

        <Divider />

        {/* Footer Actions */}
        <HStack gap={2} wrap="wrap" justify="between" align="center">
          <HStack gap={2} wrap="wrap">
            {hasVideo ? (
              <Button
                label="Download MP4"
                variant="primary"
                size="sm"
                onClick={() =>
                  triggerDownload(videoSrc, `${activeTitle.replace(/\s+/g, "_").toLowerCase()}.mp4`)
                }
              />
            ) : null}
            {hasCover ? (
              <Button
                label="Cover JPG"
                variant="secondary"
                size="sm"
                onClick={() =>
                  triggerDownload(
                    coverSrc,
                    `${activeTitle.replace(/\s+/g, "_").toLowerCase()}_cover.jpg`,
                  )
                }
              />
            ) : null}
          </HStack>

          <Button
            label="Metadata JSON"
            variant="ghost"
            size="sm"
            onClick={() => {
              const blob = new Blob([JSON.stringify(clip, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              triggerDownload(url, `${activeTitle.replace(/\s+/g, "-").toLowerCase()}.json`);
              URL.revokeObjectURL(url);
            }}
          />
        </HStack>
      </VStack>
    </Card>
  );
}

export const ClipCard = memo(
  ClipCardView,
  (previous, next) =>
    previous.jobId === next.jobId &&
    previous.clip === next.clip &&
    previous.busy === next.busy &&
    previous.captionsEnabled === next.captionsEnabled,
);
