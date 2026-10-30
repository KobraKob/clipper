"use client";

import { useState } from "react";
import { formatTimecode } from "@/lib/pipeline";
import {
  fetchClipAnalytics,
  fetchJob,
  publishClip,
  patchClip,
  rerenderClip,
  scheduleClip,
  selectTitleVariant,
} from "@/lib/api";
import type { Clip, ClipAnalytics, ClipSchedule, Platform, TitleVariant } from "@/lib/types";
import { CAPTION_STYLE_OPTIONS } from "@/lib/captionStyles";
import { normalizeTitleVariants } from "@/lib/titleVariants";

export function ClipCard({
  jobId,
  clip,
  busy,
  onKeep,
  onTimes,
  onRerender,
  captionsEnabled = true,
}: {
  jobId: string;
  clip: Clip;
  busy?: boolean;
  onKeep: (kept: boolean) => void;
  onTimes: (start: number, end: number) => void;
  onRerender?: (start: number, end: number, captionStyle?: string) => Promise<void>;
  captionsEnabled?: boolean;
}) {
  const [start, setStart] = useState(clip.start);
  const [end, setEnd] = useState(clip.end);
  const [timeError, setTimeError] = useState("");
  const [hasVideo, setHasVideo] = useState(Boolean(clip.file));
  const [hasCover, setHasCover] = useState(Boolean(clip.coverImage || clip.file));
  const [previewTab, setPreviewTab] = useState<"video" | "cover">("video");
  const [captionStyle, setCaptionStyle] = useState(clip.captionStyle || "bold_pop");

  const [publishing, setPublishing] = useState<Platform | "both" | null>(null);
  const [publishProgress, setPublishProgress] = useState(0);
  const [publishStatusText, setPublishStatusText] = useState("");
  const [publishState, setPublishState] = useState(clip.publish || {});
  const [publishPrivacy, setPublishPrivacy] = useState<"private" | "unlisted" | "public">("private");
  const [publishError, setPublishError] = useState("");
  const [copied, setCopied] = useState("");
  const [rerendering, setRerendering] = useState(false);
  const [rerenderMessage, setRerenderMessage] = useState("");
  const [videoKey, setVideoKey] = useState(0);

  // Normalize old job records before using variant IDs as React keys or selection values.
  const initialTitleVariants = normalizeTitleVariants(
    clip.titleVariants?.length ? clip.titleVariants : clip.seo?.title_variants || [],
  );
  const [titleVariants, setTitleVariants] = useState<TitleVariant[]>(initialTitleVariants);
  const [selectedVariantId, setSelectedVariantId] = useState(() => {
    const requested = clip.selectedTitleVariant || clip.seo?.selected_title_variant || "direct";
    return initialTitleVariants.some((variant) => variant.id === requested)
      ? requested
      : initialTitleVariants[0]?.id || requested;
  });
  const [activeTitle, setActiveTitle] = useState(clip.title);
  const [savingTitle, setSavingTitle] = useState(false);
  const [showMetadataEditor, setShowMetadataEditor] = useState(false);
  const [metadataTitle, setMetadataTitle] = useState(clip.seo?.youtube?.title || clip.title);
  const [metadataDescription, setMetadataDescription] = useState(clip.seo?.youtube?.description || "");
  const [metadataCaption, setMetadataCaption] = useState(clip.seo?.instagram?.caption || "");
  const [metadataHashtags, setMetadataHashtags] = useState((clip.seo?.hashtags || []).join(" "));
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [metadataMessage, setMetadataMessage] = useState("");

  // Scheduling state
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [schedulePlatform, setSchedulePlatform] = useState<Platform | "both">("youtube");
  const [scheduleTime, setScheduleTime] = useState(() => {
    const d = new Date(Date.now() + 24 * 3600 * 1000);
    d.setHours(18, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [scheduling, setScheduling] = useState(false);
  const [scheduleState, setScheduleState] = useState<ClipSchedule | undefined>(clip.schedule);
  const [scheduleMsg, setScheduleMsg] = useState("");

  // Analytics state
  const [analytics, setAnalytics] = useState<ClipAnalytics | undefined>(clip.analytics);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  const [prevClip, setPrevClip] = useState({
    start: clip.start,
    end: clip.end,
    file: clip.file,
    title: clip.title,
    captionStyle: clip.captionStyle,
  });

  if (
    prevClip.start !== clip.start ||
    prevClip.end !== clip.end ||
    prevClip.file !== clip.file ||
    prevClip.title !== clip.title ||
    prevClip.captionStyle !== clip.captionStyle
  ) {
    if (prevClip.captionStyle !== clip.captionStyle) {
      setCaptionStyle(clip.captionStyle || "bold_pop");
    }
    setPrevClip({ start: clip.start, end: clip.end, file: clip.file, title: clip.title, captionStyle: clip.captionStyle });
    setStart(clip.start);
    setEnd(clip.end);
    setTimeError("");
    if (clip.file) {
      setHasVideo(true);
      setHasCover(true);
    }
    setActiveTitle(clip.title);
    const incomingVariants = normalizeTitleVariants(
      clip.titleVariants?.length ? clip.titleVariants : clip.seo?.title_variants || [],
    );
    if (incomingVariants.length > 0) {
      setTitleVariants(incomingVariants);
      const requestedSelection = clip.selectedTitleVariant || clip.seo?.selected_title_variant;
      setSelectedVariantId(
        requestedSelection && incomingVariants.some((variant) => variant.id === requestedSelection)
          ? requestedSelection
          : incomingVariants[0].id,
      );
    }
  }

  function handleBlur() {
    if (start < 0 || end <= start) {
      setTimeError("Start must be >= 0 and end must be after start.");
      return;
    }
    setTimeError("");
    onTimes(start, end);
  }

  async function handleRerenderClick() {
    if (start < 0 || end <= start) {
      setTimeError("Invalid times for re-rendering.");
      return;
    }
    setTimeError("");
    setRerendering(true);
    setRerenderMessage("Re-rendering clip (audio trim + reframe + caption burns)…");
    try {
      if (onRerender) {
        await onRerender(start, end, captionStyle);
      } else {
        await rerenderClip(jobId, clip.id, start, end, captionStyle);
      }
      setRerenderMessage("Re-render complete!");
      setVideoKey((k) => k + 1);
      setHasVideo(true);
      setHasCover(true);
      setTimeout(() => setRerenderMessage(""), 3000);
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
      const updatedClip = res.clips.find((item) => item.id === clip.id);
      setActiveTitle(updatedClip?.title ?? clip.title);
      setMetadataTitle(updatedClip?.title ?? clip.title);
      setSelectedVariantId(updatedClip?.selectedTitleVariant ?? variantId);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Failed to select title variant.");
    } finally {
      setSavingTitle(false);
    }
  }

  async function handleSaveMetadata(e: React.FormEvent) {
    e.preventDefault();
    setSavingMetadata(true);
    setMetadataMessage("");
    const hashtags = metadataHashtags
      .split(/[\\s,]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .map((tag) => tag.startsWith("#") ? tag : `#${tag}`);
    try {
      await patchClip(jobId, clip.id, {
        title: metadataTitle.trim(),
        description: metadataDescription,
        caption: metadataCaption,
        hashtags,
      });
      setActiveTitle(metadataTitle.trim());
      setMetadataHashtags(hashtags.join(" "));
      setMetadataMessage("Changes saved to this clip.");
      setShowMetadataEditor(false);
    } catch (err) {
      setMetadataMessage(err instanceof Error ? err.message : "Could not save clip details.");
    } finally {
      setSavingMetadata(false);
    }
  }

  async function handleScheduleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!scheduleTime) return;
    setScheduling(true);
    setScheduleMsg("Scheduling clip…");
    try {
      const scheduledUtc = new Date(scheduleTime).toISOString();
      const res = await scheduleClip(jobId, clip.id, schedulePlatform, scheduledUtc);
      const updatedClip = res.clips.find((item) => item.id === clip.id);
      setScheduleState(updatedClip?.schedule);
      setScheduleMsg("Scheduled successfully!");
      setShowScheduleForm(false);
      setTimeout(() => setScheduleMsg(""), 4000);
    } catch (err) {
      setScheduleMsg(err instanceof Error ? err.message : "Scheduling failed.");
    } finally {
      setScheduling(false);
    }
  }

  async function handleRefreshAnalytics() {
    setLoadingAnalytics(true);
    try {
      const job = await fetchClipAnalytics(jobId, clip.id);
      const updated = job.clips.find((c) => c.id === clip.id);
      if (updated?.analytics) {
        setAnalytics(updated.analytics);
      }
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Failed to fetch analytics.");
    } finally {
      setLoadingAnalytics(false);
    }
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      // clipboard unavailable
    }
  }

  async function doPublish(target: Platform | "both", forceReauth = false) {
    setPublishError("");
    setPublishing(target);
    setPublishProgress(10);
    setPublishStatusText(
      forceReauth
        ? "Opening browser to connect your YouTube Channel..."
        : "Connecting to YouTube API and preparing upload...",
    );

    const timer = setInterval(async () => {
      try {
        const j = await fetchJob(jobId);
        const c = j.clips.find((x) => x.id === clip.id);
        if (c?.publish) {
          setPublishState(c.publish);
          const pKey = target === "both" ? "youtube" : target;
          const platState = c.publish[pKey];
          if (typeof platState?.progress === "number") {
            setPublishProgress(platState.progress);
            if (platState.status === "uploading") {
              setPublishStatusText(`Uploading video chunks: ${platState.progress}%`);
            }
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 1000);

    try {
      const job = await publishClip(
        jobId,
        clip.id,
        target === "both" ? ["youtube", "instagram"] : [target],
        publishPrivacy,
        forceReauth,
      );
      const updated = job.clips.find((c) => c.id === clip.id);
      setPublishState(updated?.publish || {});
      setPublishProgress(100);
      setPublishStatusText("Upload complete!");
      if (updated?.analytics) {
        setAnalytics(updated.analytics);
      }
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Publish failed.");
      setPublishStatusText("");
    } finally {
      clearInterval(timer);
      setTimeout(() => {
        setPublishing(null);
        setPublishProgress(0);
        setPublishStatusText("");
      }, 1200);
    }
  }

  const videoSrc = `/api/jobs/${jobId}/clips/${clip.id}?v=${videoKey}`;
  const coverSrc = `/api/jobs/${jobId}/clips/${clip.id}?cover=1&v=${videoKey}`;
  const isYouTubePublished = publishState.youtube?.status === "published";
  const selectedCaptionOption = CAPTION_STYLE_OPTIONS.find((option) => option.key === captionStyle) || CAPTION_STYLE_OPTIONS[0];

  return (
    <article className={`border border-white/15 bg-panel rounded-xl overflow-hidden stamp-sm transition ${clip.kept ? "" : "opacity-60"}`}>
      {/* Card Header */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b border-white/12 bg-panel-raised">
        <div className="px-4 py-3 text-volt flex items-center">
          <div className="flex items-center gap-2">
            <h3 className="display text-2xl md:text-3xl leading-tight">{activeTitle}</h3>
            {savingTitle ? (
              <span className="text-xs bg-volt text-[#101016] font-bold px-1.5 py-0.5 rounded">Saving…</span>
            ) : null}
          </div>
        </div>
        <p className="flex items-center justify-center bg-volt px-4 text-3xl font-black text-[#101016]">
          {clip.score}
        </p>
      </div>

      <div className="flex flex-col gap-4 p-4 md:p-5">
        {/* Retention Badges & Hook Callout */}
        <div className="flex flex-wrap items-center gap-2">
          {clip.hook ? (
            <span className="border border-volt/40 bg-volt/10 px-2.5 py-1 text-xs font-bold text-volt rounded">
              🎯 Hook (0–2.5s): &ldquo;{clip.hook}&rdquo;
            </span>
          ) : null}
          {clip.hookOverlay !== false ? (
            <span className="border border-white/12 bg-panel-raised px-2 py-0.5 text-[11px] font-semibold text-muted rounded">
              ✨ Hook Overlay
            </span>
          ) : null}
          {clip.loudnorm !== false ? (
            <span className="border border-white/12 bg-panel-raised px-2 py-0.5 text-[11px] font-semibold text-muted rounded">
              🔊 -14 LUFS
            </span>
          ) : null}
          {clip.progressBar ? (
            <span className="border border-white/12 bg-panel-raised px-2 py-0.5 text-[11px] font-semibold text-muted rounded">
              ⏱️ Progress Bar
            </span>
          ) : null}
          {clip.captionStyle ? (
            <span className="border border-white/12 bg-panel-raised px-2 py-0.5 text-[11px] font-semibold text-muted rounded">
              💬 {clip.captionStyle}
            </span>
          ) : null}
        </div>

        {/* Video / Cover Frame Preview */}
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <div className="flex flex-col gap-1.5 shrink-0">
            {/* View Switcher: Video vs Cover */}
            {hasVideo && hasCover ? (
              <div className="flex border border-white/15 rounded overflow-hidden text-xs font-bold bg-panel-inset">
                <button
                  type="button"
                  onClick={() => setPreviewTab("video")}
                  className={`flex-1 px-3 py-1 text-center transition cursor-pointer ${
                    previewTab === "video" ? "bg-volt text-[#101016]" : "bg-panel-raised text-muted hover:text-ink"
                  }`}
                >
                  Video
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab("cover")}
                  className={`flex-1 px-3 py-1 text-center transition cursor-pointer ${
                    previewTab === "cover" ? "bg-volt text-[#101016]" : "bg-panel-raised text-muted hover:text-ink"
                  }`}
                >
                  Cover
                </button>
              </div>
            ) : null}

            {previewTab === "cover" && hasCover ? (
              <div className="aspect-[9/16] max-h-80 w-44 shrink-0 overflow-hidden border border-white/20 bg-black rounded-lg relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={coverSrc}
                  alt={`Cover thumbnail frame for ${clip.title}`}
                  className="h-full w-full object-cover"
                  onError={() => setHasCover(false)}
                />
                <span className="absolute bottom-1 right-1 bg-black/80 text-[10px] text-volt px-1.5 py-0.5 font-bold rounded">
                  Cover Frame
                </span>
              </div>
            ) : hasVideo ? (
              <div className="aspect-[9/16] max-h-80 w-44 shrink-0 overflow-hidden border border-white/20 bg-black rounded-lg">
                <video
                  key={videoKey}
                  controls
                  playsInline
                  preload="metadata"
                  src={videoSrc}
                  className="h-full w-full object-cover"
                  onError={() => setHasVideo(false)}
                />
              </div>
            ) : (
              <div className="aspect-[9/16] max-h-72 w-40 shrink-0 self-start border border-white/20 bg-panel-inset p-3 text-volt rounded-lg flex flex-col justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted">9:16 Preview</p>
                  <p className="display mt-4 text-2xl leading-tight text-ink">
                    {clip.hook.split(" ").slice(0, 8).join(" ")}
                  </p>
                </div>
                <p className="text-[10px] font-semibold text-muted font-mono">
                  {formatTimecode(clip.start)} – {formatTimecode(clip.end)}
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2.5">
            <p className="font-semibold text-ice text-sm">{clip.reason}</p>
            <p className="text-sm text-ink/90 bg-panel-inset/60 border border-white/8 p-3 rounded-lg leading-relaxed">
              {clip.text}
            </p>
          </div>
        </div>

        {/* Timestamps and Rerender */}
        <div className="flex flex-col gap-2.5 border border-white/10 bg-panel-raised/50 p-3.5 rounded-lg">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted uppercase tracking-wider">
              Start Time (s)
              <input
                type="number"
                min={0}
                step={0.1}
                value={start}
                disabled={rerendering}
                className="border border-white/20 bg-panel-inset text-ink px-2.5 py-2 font-mono rounded text-sm focus:border-ice focus:outline-none"
                onChange={(e) => setStart(Number(e.target.value))}
                onBlur={handleBlur}
              />
              <span className="font-normal text-xs text-muted">{formatTimecode(start)}</span>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted uppercase tracking-wider">
              End Time (s)
              <input
                type="number"
                min={0}
                step={0.1}
                value={end}
                disabled={rerendering}
                className="border border-white/20 bg-panel-inset text-ink px-2.5 py-2 font-mono rounded text-sm focus:border-ice focus:outline-none"
                onChange={(e) => setEnd(Number(e.target.value))}
                onBlur={handleBlur}
              />
              <span className="font-normal text-xs text-muted">{formatTimecode(end)}</span>
            </label>
          </div>

          {captionsEnabled ? (
            <div className="grid gap-3 rounded-lg border border-white/10 bg-panel-inset/50 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-wider text-muted">
                Caption style
                <select
                  value={captionStyle}
                  disabled={rerendering || busy}
                  onChange={(event) => setCaptionStyle(event.target.value)}
                  className="min-h-10 rounded-lg border border-white/15 bg-panel-inset px-3 text-sm font-semibold normal-case tracking-normal text-ink focus:border-ice focus:outline-none"
                >
                  {CAPTION_STYLE_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
                <span className="font-normal normal-case tracking-normal text-muted">{selectedCaptionOption.description}</span>
              </label>
              <div className="flex min-h-24 flex-col justify-center rounded-lg border border-white/10 bg-[#07090e] px-3 py-2.5">
                <span className="text-[9px] font-bold uppercase tracking-[.15em] text-muted">Style preview</span>
                <div className="mt-2 flex min-h-8 flex-wrap items-center justify-center gap-x-1.5 gap-y-1">
                  {(captionStyle === "one_word" ? ["THIS"] : ["MAKE", "IT", "COUNT"]).map((word, index) => {
                    const active = index === (captionStyle === "one_word" ? 0 : 1);
                    return (
                      <span
                        key={word}
                        style={{
                          font: selectedCaptionOption.font,
                          color: active ? selectedCaptionOption.active : selectedCaptionOption.base,
                          background: active ? selectedCaptionOption.activeBg : undefined,
                          padding: active && selectedCaptionOption.activeBg ? "1px 4px" : undefined,
                          borderRadius: 3,
                          WebkitTextStroke: `0.7px ${selectedCaptionOption.stroke}`,
                          textShadow: selectedCaptionOption.glow ? `0 0 7px ${selectedCaptionOption.glow}` : undefined,
                        }}
                      >
                        {selectedCaptionOption.upper ? word : word.toLowerCase()}
                      </span>
                    );
                  })}
                </div>
                <p className="mt-2 text-center text-[10px] text-muted">Preview is illustrative; the rendered clip uses word timestamps.</p>
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={rerendering || busy}
              onClick={handleRerenderClick}
              className="border border-white/20 bg-panel px-3 py-1.5 text-xs font-bold text-ink rounded hover:bg-volt hover:text-[#101016] hover:border-volt transition disabled:opacity-60 cursor-pointer"
            >
              {rerendering ? "Re-rendering…" : clip.captionStyle !== captionStyle ? "Apply style & re-render" : "Re-render Video"}
            </button>
            {rerenderMessage ? (
              <span className="text-xs font-semibold text-volt">{rerenderMessage}</span>
            ) : null}
          </div>
        </div>

        {timeError ? (
          <p role="alert" className="text-xs font-bold text-punch">
            {timeError}
          </p>
        ) : null}

        {/* Title A/B Variants Selector */}
        {titleVariants.length > 0 ? (
          <div className="flex flex-col gap-2.5 border border-white/10 bg-panel-raised/40 p-3.5 rounded-lg text-sm">
            <div className="flex items-center justify-between">
              <p className="font-bold text-ink">Title A/B Variants (Viral Testing)</p>
              <span className="text-[11px] font-mono font-bold bg-volt text-[#101016] px-2 py-0.5 rounded">
                A/B Engine
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {titleVariants.map((v) => (
                <label
                  key={v.id}
                  className={`flex items-start gap-2.5 p-3 border rounded-lg cursor-pointer transition ${
                    selectedVariantId === v.id
                      ? "border-volt bg-volt/10 font-semibold"
                      : "border-white/10 bg-panel-raised hover:border-white/25"
                  }`}
                >
                  <input
                    type="radio"
                    name={`variant-${clip.id}`}
                    value={v.id}
                    checked={selectedVariantId === v.id}
                    onChange={() => handleSelectVariant(v.id)}
                    className="mt-1 h-4 w-4 accent-volt cursor-pointer"
                  />
                  <div className="flex flex-col flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted">
                        {v.label || v.angle || v.id}
                      </span>
                      {selectedVariantId === v.id ? (
                        <span className="text-[10px] font-bold bg-volt text-[#101016] px-1.5 py-0.5 rounded">
                          ACTIVE FOR PUBLISH
                        </span>
                      ) : null}
                    </div>
                    <span className="text-sm mt-1 text-ink">{v.title}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {/* Editable publishing copy */}
        <section className="flex flex-col gap-3 border border-white/10 bg-panel-raised/40 p-3.5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-bold text-ink">Publishing copy</p>
              <p className="text-xs text-muted">Title, description, caption and hashtags for this clip</p>
            </div>
            <button type="button" onClick={() => setShowMetadataEditor((open) => !open)} className="border border-volt bg-volt px-3 py-2 text-xs font-black uppercase tracking-wide text-[#101016] hover:bg-[#f6f0df] transition cursor-pointer">
              {showMetadataEditor ? "Close editor" : "Edit details"}
            </button>
          </div>
          <p className="font-semibold text-volt">{metadataTitle || "No title set"}</p>
          {metadataDescription ? <p className="whitespace-pre-line text-muted text-xs leading-relaxed">{metadataDescription}</p> : null}
          {metadataCaption ? <p className="whitespace-pre-line text-ink/80 text-xs leading-relaxed">{metadataCaption}</p> : null}
          {metadataHashtags ? <p className="text-xs text-volt break-words">{metadataHashtags}</p> : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" disabled={!metadataTitle.trim() && !metadataDescription.trim()} className="border border-white/20 bg-panel px-3 py-1.5 text-xs font-semibold text-ink hover:bg-volt hover:text-[#101016] transition cursor-pointer disabled:opacity-40" onClick={() => copy("yt", `${metadataTitle}\\n\\n${metadataDescription}`)}>
              {copied === "yt" ? "Copied" : "Copy YouTube text"}
            </button>
            <button type="button" disabled={!metadataCaption.trim() && !metadataHashtags.trim()} className="border border-white/20 bg-panel px-3 py-1.5 text-xs font-semibold text-ink hover:bg-volt hover:text-[#101016] transition cursor-pointer disabled:opacity-40" onClick={() => copy("ig", [metadataCaption, metadataHashtags].filter(Boolean).join("\\n\\n"))}>
              {copied === "ig" ? "Copied" : "Copy Instagram caption"}
            </button>
          </div>
          {showMetadataEditor ? (
            <form onSubmit={handleSaveMetadata} className="grid gap-3 border-t border-white/10 pt-3">
              <label className="grid gap-1 text-xs font-bold uppercase tracking-wide text-muted">
                Clip title <span className="font-normal normal-case tracking-normal">Up to 100 characters</span>
                <input value={metadataTitle} maxLength={100} onChange={(event) => setMetadataTitle(event.target.value)} className="min-h-10 border border-white/20 bg-panel-inset px-3 text-sm normal-case tracking-normal text-ink outline-none focus:border-volt" />
              </label>
              <label className="grid gap-1 text-xs font-bold uppercase tracking-wide text-muted">
                Description
                <textarea value={metadataDescription} maxLength={5000} rows={4} onChange={(event) => setMetadataDescription(event.target.value)} placeholder="Write a YouTube description…" className="border border-white/20 bg-panel-inset px-3 py-2 text-sm normal-case tracking-normal text-ink outline-none focus:border-volt" />
              </label>
              <label className="grid gap-1 text-xs font-bold uppercase tracking-wide text-muted">
                Caption
                <textarea value={metadataCaption} maxLength={2200} rows={4} onChange={(event) => setMetadataCaption(event.target.value)} placeholder="Write an Instagram or Reels caption…" className="border border-white/20 bg-panel-inset px-3 py-2 text-sm normal-case tracking-normal text-ink outline-none focus:border-volt" />
              </label>
              <label className="grid gap-1 text-xs font-bold uppercase tracking-wide text-muted">
                Hashtags
                <textarea value={metadataHashtags} rows={2} onChange={(event) => setMetadataHashtags(event.target.value)} placeholder="#creator #shorts #reels" className="border border-white/20 bg-panel-inset px-3 py-2 text-sm normal-case tracking-normal text-ink outline-none focus:border-volt" />
                <span className="font-normal normal-case tracking-normal">Separate hashtags with spaces, commas or new lines. The # is added automatically.</span>
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={savingMetadata} className="bg-volt px-4 py-2 text-xs font-black uppercase tracking-wide text-[#101016] hover:bg-[#f6f0df] disabled:opacity-50 cursor-pointer">
                  {savingMetadata ? "Saving…" : "Save clip details"}
                </button>
                <button type="button" onClick={() => setShowMetadataEditor(false)} className="px-3 py-2 text-xs font-bold text-muted hover:text-ink cursor-pointer">Cancel</button>
                <span aria-live="polite" className="text-xs text-muted">{metadataMessage}</span>
              </div>
            </form>
          ) : null}
          {metadataMessage && !showMetadataEditor ? <p role="status" className="text-xs text-volt">{metadataMessage}</p> : null}
        </section>

        {/* Publish & Distribution Hub */}
        {hasVideo && clip.seo ? (
          <div className="flex flex-col gap-3.5 border border-white/10 p-3.5 bg-panel-raised/30 rounded-lg">
            <div className="flex items-center justify-between">
              <p className="font-bold text-ink">Publish &amp; Distribution</p>
              <button
                type="button"
                onClick={() => setShowScheduleForm(!showScheduleForm)}
                className="text-xs font-bold underline text-muted hover:text-volt transition cursor-pointer"
              >
                {showScheduleForm ? "Hide Scheduling" : "Schedule in Posting Queue"}
              </button>
            </div>

            {/* Instant Publish */}
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                Visibility:
                <select
                  value={publishPrivacy}
                  onChange={(e) =>
                    setPublishPrivacy(e.target.value as "private" | "unlisted" | "public")
                  }
                  className="border border-white/20 p-1.5 text-xs bg-panel-inset text-ink rounded font-normal"
                >
                  <option value="private">Private</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="public">Public</option>
                </select>
              </label>
              {(["youtube", "instagram", "both"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={publishing !== null}
                  onClick={() => doPublish(t)}
                  className="border border-white/20 bg-panel text-ink px-3.5 py-2 text-xs font-bold rounded-lg hover:bg-volt hover:text-[#101016] hover:border-volt transition disabled:opacity-60 disabled:cursor-wait cursor-pointer"
                >
                  {publishing === t
                    ? "Uploading…"
                    : t === "youtube"
                    ? "YouTube Shorts"
                    : t === "instagram"
                    ? "Instagram Reels"
                    : "Publish Both"}
                </button>
              ))}
            </div>

            {/* Live Upload Progress Feedback */}
            {publishing !== null ? (
              <div className="border border-volt/30 bg-volt/10 p-3 rounded-lg flex flex-col gap-2 animate-pulse">
                <div className="flex items-center justify-between text-xs font-bold text-volt">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-volt animate-ping" />
                    {publishing === "youtube"
                      ? "Uploading YouTube Short"
                      : publishing === "instagram"
                      ? "Uploading Instagram Reel"
                      : "Publishing to Platforms"}
                  </span>
                  <span>{publishProgress}%</span>
                </div>
                <div className="w-full bg-black/40 h-2 rounded overflow-hidden">
                  <div
                    className="bg-volt h-full transition-all duration-300 ease-out"
                    style={{ width: `${Math.max(5, publishProgress)}%` }}
                  />
                </div>
                <p className="text-[11px] text-muted font-medium">
                  {publishStatusText || "Streaming media chunks to platform API..."}
                </p>
              </div>
            ) : null}

            {/* Schedule Post Form */}
            {showScheduleForm ? (
              <form
                onSubmit={handleScheduleSubmit}
                className="flex flex-col gap-3 p-3.5 border border-white/12 bg-panel-inset rounded-lg"
              >
                <p className="text-xs font-bold uppercase tracking-wider text-volt">
                  Posting Queue Scheduler
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="flex flex-col text-xs font-semibold text-muted">
                    Target Platform
                    <select
                      value={schedulePlatform}
                      onChange={(e) => setSchedulePlatform(e.target.value as Platform | "both")}
                      className="border border-white/20 p-2 mt-1 text-sm bg-panel text-ink rounded"
                    >
                      <option value="youtube">YouTube Shorts</option>
                      <option value="instagram">Instagram Reels</option>
                      <option value="both">Both Platforms</option>
                    </select>
                  </label>
                  <label className="flex flex-col text-xs font-semibold text-muted">
                    Scheduled Time
                    <input
                      type="datetime-local"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="border border-white/20 p-2 mt-1 text-sm bg-panel text-ink rounded font-mono"
                    />
                  </label>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={scheduling}
                    className="bg-volt px-4 py-1.5 text-xs font-bold text-[#101016] rounded hover:bg-[#e4ff78] transition disabled:opacity-60 cursor-pointer"
                  >
                    {scheduling ? "Scheduling…" : "Confirm Schedule"}
                  </button>
                  {scheduleMsg ? (
                    <span className="text-xs font-semibold text-volt">{scheduleMsg}</span>
                  ) : null}
                </div>
              </form>
            ) : null}

            {/* Schedule State Badge */}
            {scheduleState ? (
              <div className="flex items-center gap-2 border border-volt/30 bg-volt/10 p-2.5 rounded-lg text-xs font-semibold text-ink">
                <span>📅 Scheduled:</span>
                <span className="font-mono text-volt">
                  {new Date(
                    scheduleState.scheduled_at ||
                      scheduleState.publishAt ||
                      scheduleState.published_at ||
                      "",
                  ).toLocaleString()}
                </span>
                <span className="bg-volt text-[#101016] px-1.5 py-0.5 text-[10px] font-bold uppercase rounded">
                  {scheduleState.status}
                </span>
              </div>
            ) : null}

            {/* Publishing Results & Errors */}
            {(["youtube", "instagram"] as const).map((p) => {
              const r = publishState[p];
              if (!r) return null;
              return r.status === "published" ? (
                <p key={p} className="text-xs font-semibold text-volt">
                  {p === "youtube" ? "YouTube" : "Instagram"}: published{" "}
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer" className="underline font-bold text-ice">
                      open post ↗
                    </a>
                  ) : null}
                </p>
              ) : (
                <div
                  key={p}
                  role="alert"
                  className="border border-punch/50 bg-punch/10 p-3 rounded-lg text-xs font-semibold text-punch flex flex-col gap-2"
                >
                  <div>
                    <p className="font-bold">
                      {p === "youtube" ? "YouTube Shorts" : "Instagram Reels"} Publish Notice:
                    </p>
                    <p className="mt-1">{r.error}</p>
                  </div>
                  {p === "youtube" ? (
                    <button
                      type="button"
                      disabled={publishing !== null}
                      onClick={() => doPublish("youtube", true)}
                      className="self-start border border-punch bg-panel px-3 py-1.5 text-xs font-bold text-punch hover:bg-punch hover:text-white rounded transition disabled:opacity-60 cursor-pointer"
                    >
                      Sign In with Another Google Account ↗
                    </button>
                  ) : null}
                </div>
              );
            })}

            {publishError ? (
              <div
                role="alert"
                className="border border-punch/50 bg-punch/10 p-3 rounded-lg text-xs font-bold text-punch"
              >
                {publishError}
              </div>
            ) : null}

            {/* Analytics Loop Card (When published on YouTube or analytics present) */}
            {isYouTubePublished || analytics ? (
              <div className="flex flex-col gap-2.5 border border-white/12 bg-panel p-3.5 rounded-lg">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-ink text-xs uppercase tracking-wider">
                    YouTube Performance Analytics
                  </p>
                  <button
                    type="button"
                    disabled={loadingAnalytics}
                    onClick={handleRefreshAnalytics}
                    className="border border-white/20 bg-panel-raised px-2.5 py-1 text-[11px] font-semibold text-muted hover:text-ink rounded transition disabled:opacity-60 cursor-pointer"
                  >
                    {loadingAnalytics ? "Refreshing…" : "Refresh Stats"}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center pt-1">
                  <div className="border border-white/10 bg-panel-inset p-2.5 rounded">
                    <span className="text-[10px] text-muted uppercase block font-semibold">
                      Views
                    </span>
                    <span className="text-lg font-extrabold text-volt">
                      {analytics?.view_count ?? analytics?.views ?? 0}
                    </span>
                  </div>
                  <div className="border border-white/10 bg-panel-inset p-2.5 rounded">
                    <span className="text-[10px] text-muted uppercase block font-semibold">
                      Likes
                    </span>
                    <span className="text-lg font-extrabold text-volt">
                      {analytics?.like_count ?? analytics?.likes ?? 0}
                    </span>
                  </div>
                  <div className="border border-white/10 bg-panel-inset p-2.5 rounded">
                    <span className="text-[10px] text-muted uppercase block font-semibold">
                      Comments
                    </span>
                    <span className="text-lg font-extrabold text-volt">
                      {analytics?.comment_count ?? analytics?.comments ?? 0}
                    </span>
                  </div>
                </div>
                {(analytics?.retention_seconds || analytics?.retentionSeconds) ? (
                  <p className="text-[11px] text-muted">
                    Average retention: {analytics.retention_seconds ?? analytics.retentionSeconds}s
                  </p>
                ) : null}
              </div>
            ) : null}

            <p className="text-xs text-muted">
              YouTube uploads default to private (selectable above or via YOUTUBE_PRIVACY in .env). Instagram requires INSTAGRAM_ACCESS_TOKEN.
            </p>
          </div>
        ) : null}

        {/* Card Footer Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/10">
          <button
            type="button"
            disabled={busy}
            onClick={() => onKeep(!clip.kept)}
            className="bg-volt px-4 py-2 font-bold text-xs text-[#101016] hover:bg-[#e4ff78] rounded-lg transition cursor-pointer"
          >
            {clip.kept ? "Drop this clip" : "Keep this clip"}
          </button>

          {hasVideo ? (
            <a
              href={videoSrc}
              download={`${activeTitle.replace(/\s+/g, "_").toLowerCase()}.mp4`}
              className="bg-punch text-white px-4 py-2 font-bold text-xs hover:bg-punch/90 rounded-lg transition inline-block text-center cursor-pointer"
            >
              Download MP4
            </a>
          ) : null}

          {hasCover ? (
            <a
              href={coverSrc}
              download={`${activeTitle.replace(/\s+/g, "_").toLowerCase()}_cover.jpg`}
              className="border border-white/20 bg-panel px-4 py-2 font-semibold text-xs text-ink hover:bg-panel-raised rounded-lg transition inline-block text-center cursor-pointer"
            >
              Download Cover JPEG
            </a>
          ) : null}

          <button
            type="button"
            className="border border-white/20 bg-panel px-4 py-2 font-semibold text-xs text-ink hover:bg-panel-raised rounded-lg transition cursor-pointer"
            onClick={() => {
              const blob = new Blob([JSON.stringify(clip, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${activeTitle.replace(/\s+/g, "-").toLowerCase()}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Metadata JSON
          </button>
        </div>
      </div>
    </article>
  );
}
