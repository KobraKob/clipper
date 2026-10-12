"use client";

import { useState } from "react";
import { formatTimecode } from "@/lib/pipeline";
import {
  fetchClipAnalytics,
  fetchJob,
  publishClip,
  rerenderClip,
  scheduleClip,
  selectTitleVariant,
} from "@/lib/api";
import type { Clip, ClipAnalytics, ClipSchedule, Platform, TitleVariant } from "@/lib/types";

export function ClipCard({
  jobId,
  clip,
  busy,
  onKeep,
  onTimes,
  onRerender,
}: {
  jobId: string;
  clip: Clip;
  busy?: boolean;
  onKeep: (kept: boolean) => void;
  onTimes: (start: number, end: number) => void;
  onRerender?: (start: number, end: number) => Promise<void>;
}) {
  const [start, setStart] = useState(clip.start);
  const [end, setEnd] = useState(clip.end);
  const [timeError, setTimeError] = useState("");
  const [hasVideo, setHasVideo] = useState(Boolean(clip.file));
  const [hasCover, setHasCover] = useState(Boolean(clip.coverImage || clip.file));
  const [previewTab, setPreviewTab] = useState<"video" | "cover">("video");

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

  // A/B Title Variants state
  const [titleVariants, setTitleVariants] = useState<TitleVariant[]>(
    clip.titleVariants || clip.seo?.title_variants || [],
  );
  const [selectedVariantId, setSelectedVariantId] = useState(
    clip.selectedTitleVariant || clip.seo?.selected_title_variant || "direct",
  );
  const [activeTitle, setActiveTitle] = useState(clip.title);
  const [savingTitle, setSavingTitle] = useState(false);

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
  });

  if (
    prevClip.start !== clip.start ||
    prevClip.end !== clip.end ||
    prevClip.file !== clip.file ||
    prevClip.title !== clip.title
  ) {
    setPrevClip({ start: clip.start, end: clip.end, file: clip.file, title: clip.title });
    setStart(clip.start);
    setEnd(clip.end);
    setTimeError("");
    if (clip.file) {
      setHasVideo(true);
      setHasCover(true);
    }
    setActiveTitle(clip.title);
    if (clip.titleVariants && clip.titleVariants.length > 0) {
      setTitleVariants(clip.titleVariants);
    }
    if (clip.selectedTitleVariant) {
      setSelectedVariantId(clip.selectedTitleVariant);
    }
    if (clip.schedule) {
      setScheduleState(clip.schedule);
    }
    if (clip.analytics) {
      setAnalytics(clip.analytics);
    }
  }

  function handleBlur() {
    if (isNaN(start) || isNaN(end) || start < 0) {
      setTimeError("Timestamps must be non-negative numbers.");
      return;
    }
    if (end <= start) {
      setTimeError("End time must be greater than start time.");
      return;
    }
    setTimeError("");
    onTimes(start, end);
  }

  async function handleRerenderClick() {
    if (isNaN(start) || isNaN(end) || start < 0) {
      setTimeError("Timestamps must be non-negative numbers.");
      return;
    }
    if (end <= start) {
      setTimeError("End time must be greater than start time.");
      return;
    }
    setTimeError("");
    setRerendering(true);
    setRerenderMessage("Re-rendering video (cutting, reframing & subtitles)…");

    try {
      if (onRerender) {
        await onRerender(start, end);
      } else {
        await rerenderClip(jobId, clip.id, start, end);
      }
      setVideoKey(Date.now());
      setHasVideo(true);
      setHasCover(true);
      setRerenderMessage("Re-render complete!");
      setTimeout(() => setRerenderMessage(""), 3000);
    } catch (err) {
      setTimeError(err instanceof Error ? err.message : "Re-rendering clip failed.");
      setRerenderMessage("");
    } finally {
      setRerendering(false);
    }
  }

  async function handleSelectVariant(variantId: string) {
    setSelectedVariantId(variantId);
    const chosen = titleVariants.find((v) => v.id === variantId);
    if (chosen) {
      setActiveTitle(chosen.title);
    }
    setSavingTitle(true);
    try {
      const job = await selectTitleVariant(jobId, clip.id, variantId);
      const updated = job.clips.find((c) => c.id === clip.id);
      if (updated) {
        setActiveTitle(updated.title);
        setSelectedVariantId(updated.selectedTitleVariant || variantId);
      }
    } catch (err) {
      console.error("Failed to update title variant", err);
    } finally {
      setSavingTitle(false);
    }
  }

  async function handleScheduleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!scheduleTime) return;
    setScheduling(true);
    setScheduleMsg("");
    setPublishError("");
    try {
      const targetIso = new Date(scheduleTime).toISOString();
      const job = await scheduleClip(jobId, clip.id, schedulePlatform, targetIso);
      const updated = job.clips.find((c) => c.id === clip.id);
      setScheduleState(updated?.schedule);
      setScheduleMsg("Post scheduled in queue!");
      setTimeout(() => setScheduleMsg(""), 4000);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Failed to schedule clip.");
    } finally {
      setScheduling(false);
    }
  }

  async function handleRefreshAnalytics() {
    setLoadingAnalytics(true);
    setPublishError("");
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
          if (platState?.progress) {
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

  return (
    <article className={`border-4 border-court bg-white stamp-sm ${clip.kept ? "" : "opacity-60"}`}>
      {/* Card Header */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b-4 border-court">
        <div className="bg-court px-3 py-3 text-volt">
          <div className="flex items-center gap-2">
            <h3 className="display text-3xl">{activeTitle}</h3>
            {savingTitle ? (
              <span className="text-xs bg-volt text-ink font-bold px-1.5 py-0.5">Saving…</span>
            ) : null}
          </div>
        </div>
        <p className="flex items-center bg-volt px-4 text-3xl font-extrabold text-ink">
          {clip.score}
        </p>
      </div>

      <div className="flex flex-col gap-4 p-4">
        {/* Retention Badges & Hook Callout */}
        <div className="flex flex-wrap items-center gap-2">
          {clip.hook ? (
            <span className="border-2 border-court bg-volt/30 px-2 py-0.5 text-xs font-bold text-ink">
              🎯 Hook (0–2.5s): &ldquo;{clip.hook}&rdquo;
            </span>
          ) : null}
          {clip.hookOverlay !== false ? (
            <span className="border border-court/40 bg-white px-2 py-0.5 text-[11px] font-semibold text-court">
              ✨ Hook Overlay
            </span>
          ) : null}
          {clip.loudnorm !== false ? (
            <span className="border border-court/40 bg-white px-2 py-0.5 text-[11px] font-semibold text-court">
              🔊 -14 LUFS
            </span>
          ) : null}
          {clip.progressBar ? (
            <span className="border border-court/40 bg-white px-2 py-0.5 text-[11px] font-semibold text-court">
              ⏱️ Progress Bar
            </span>
          ) : null}
          {clip.captionStyle ? (
            <span className="border border-court/40 bg-white px-2 py-0.5 text-[11px] font-semibold text-court">
              💬 {clip.captionStyle}
            </span>
          ) : null}
        </div>

        {/* Video / Cover Frame Preview */}
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <div className="flex flex-col gap-1 shrink-0">
            {/* View Switcher: Video vs Cover */}
            {hasVideo && hasCover ? (
              <div className="flex border-2 border-court text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setPreviewTab("video")}
                  className={`flex-1 px-2 py-1 text-center transition ${
                    previewTab === "video" ? "bg-volt text-ink" : "bg-white text-ink/70 hover:bg-paper"
                  }`}
                >
                  Video
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab("cover")}
                  className={`flex-1 px-2 py-1 text-center transition ${
                    previewTab === "cover" ? "bg-volt text-ink" : "bg-white text-ink/70 hover:bg-paper"
                  }`}
                >
                  Cover
                </button>
              </div>
            ) : null}

            {previewTab === "cover" && hasCover ? (
              <div className="aspect-[9/16] max-h-80 w-44 shrink-0 overflow-hidden border-4 border-ink bg-ink relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={coverSrc}
                  alt={`Cover thumbnail frame for ${clip.title}`}
                  className="h-full w-full object-cover"
                  onError={() => setHasCover(false)}
                />
                <span className="absolute bottom-1 right-1 bg-ink/80 text-[10px] text-volt px-1 font-bold">
                  Cover Frame
                </span>
              </div>
            ) : hasVideo ? (
              <div className="aspect-[9/16] max-h-80 w-44 shrink-0 overflow-hidden border-4 border-ink bg-ink">
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
              <div className="aspect-[9/16] max-h-72 w-40 shrink-0 self-start border-4 border-ink bg-court p-3 text-volt flex flex-col justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white">9:16 Preview</p>
                  <p className="display mt-4 text-2xl leading-tight">
                    {clip.hook.split(" ").slice(0, 8).join(" ")}
                  </p>
                </div>
                <p className="text-[10px] font-semibold text-white/80">
                  {formatTimecode(clip.start)} – {formatTimecode(clip.end)}
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <p className="font-semibold text-court">{clip.reason}</p>
            <p className="text-sm text-ink/80">{clip.text}</p>
          </div>
        </div>

        {/* Timestamps and Rerender */}
        <div className="flex flex-col gap-2 border-2 border-court/20 bg-paper/30 p-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Start Time (s)
              <input
                type="number"
                min={0}
                step={0.1}
                value={start}
                disabled={rerendering}
                className="border-4 border-court px-2 py-2 font-mono"
                onChange={(e) => setStart(Number(e.target.value))}
                onBlur={handleBlur}
              />
              <span className="font-normal text-xs text-ink/70">{formatTimecode(start)}</span>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              End Time (s)
              <input
                type="number"
                min={0}
                step={0.1}
                value={end}
                disabled={rerendering}
                className="border-4 border-court px-2 py-2 font-mono"
                onChange={(e) => setEnd(Number(e.target.value))}
                onBlur={handleBlur}
              />
              <span className="font-normal text-xs text-ink/70">{formatTimecode(end)}</span>
            </label>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={rerendering || busy}
              onClick={handleRerenderClick}
              className="border-2 border-court bg-white px-3 py-1 text-xs font-bold hover:bg-volt transition disabled:opacity-60"
            >
              {rerendering ? "Re-rendering…" : "Re-render Video"}
            </button>
            {rerenderMessage ? (
              <span className="text-xs font-semibold text-court">{rerenderMessage}</span>
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
          <div className="flex flex-col gap-2 border-2 border-court/30 bg-paper/40 p-3 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-bold text-court">Title A/B Variants (Viral Testing)</p>
              <span className="text-[11px] font-mono font-bold bg-volt text-ink px-2 py-0.5">
                A/B Engine
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {titleVariants.map((v) => (
                <label
                  key={v.id}
                  className={`flex items-start gap-2 p-2.5 border-2 cursor-pointer transition ${
                    selectedVariantId === v.id
                      ? "border-court bg-volt/30 font-semibold"
                      : "border-court/30 bg-white hover:bg-paper"
                  }`}
                >
                  <input
                    type="radio"
                    name={`variant-${clip.id}`}
                    value={v.id}
                    checked={selectedVariantId === v.id}
                    onChange={() => handleSelectVariant(v.id)}
                    className="mt-1 h-4 w-4 accent-punch cursor-pointer"
                  />
                  <div className="flex flex-col flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-court">
                        {v.label || v.angle || v.id}
                      </span>
                      {selectedVariantId === v.id ? (
                        <span className="text-[10px] font-bold bg-court text-volt px-1.5 py-0.5">
                          ACTIVE FOR PUBLISH
                        </span>
                      ) : null}
                    </div>
                    <span className="text-sm mt-0.5 text-ink">{v.title}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {/* SEO Metadata and Copy Buttons */}
        {clip.seo ? (
          <div className="flex flex-col gap-2 border-2 border-court/30 bg-paper/50 p-3 text-sm">
            <p className="font-bold text-court">Title, description &amp; hashtags</p>
            <p className="font-semibold">{clip.seo.youtube.title}</p>
            <p className="whitespace-pre-line text-ink/80">{clip.seo.youtube.description}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="border-2 border-court bg-white px-2 py-1 text-xs font-semibold hover:bg-volt transition"
                onClick={() =>
                  copy("yt", `${clip.seo!.youtube.title}\n\n${clip.seo!.youtube.description}`)
                }
              >
                {copied === "yt" ? "Copied" : "Copy YouTube text"}
              </button>
              <button
                type="button"
                className="border-2 border-court bg-white px-2 py-1 text-xs font-semibold hover:bg-volt transition"
                onClick={() => copy("ig", clip.seo!.instagram.caption)}
              >
                {copied === "ig" ? "Copied" : "Copy Instagram caption"}
              </button>
            </div>
          </div>
        ) : null}

        {/* Publish & Distribution Hub */}
        {hasVideo && clip.seo ? (
          <div className="flex flex-col gap-3 border-2 border-court/30 p-3 bg-paper/20">
            <div className="flex items-center justify-between">
              <p className="font-bold text-court">Publish &amp; Distribution</p>
              <button
                type="button"
                onClick={() => setShowScheduleForm(!showScheduleForm)}
                className="text-xs font-bold underline text-court hover:text-punch"
              >
                {showScheduleForm ? "Hide Scheduling" : "Schedule in Posting Queue"}
              </button>
            </div>

            {/* Instant Publish */}
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-court">
                Visibility:
                <select
                  value={publishPrivacy}
                  onChange={(e) =>
                    setPublishPrivacy(e.target.value as "private" | "unlisted" | "public")
                  }
                  className="border-2 border-court p-1 text-xs bg-paper font-normal"
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
                  className="border-4 border-court bg-white px-3 py-2 font-semibold hover:bg-volt transition disabled:opacity-60 disabled:cursor-wait"
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
              <div className="border-2 border-court bg-volt/20 p-3 flex flex-col gap-1.5 animate-pulse">
                <div className="flex items-center justify-between text-xs font-bold text-court">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-court animate-ping" />
                    {publishing === "youtube"
                      ? "Uploading YouTube Short"
                      : publishing === "instagram"
                      ? "Uploading Instagram Reel"
                      : "Publishing to Platforms"}
                  </span>
                  <span>{publishProgress}%</span>
                </div>
                <div className="w-full bg-court/20 h-2.5 border border-court overflow-hidden">
                  <div
                    className="bg-court h-full transition-all duration-300 ease-out"
                    style={{ width: `${Math.max(5, publishProgress)}%` }}
                  />
                </div>
                <p className="text-[11px] text-ink/80 font-medium">
                  {publishStatusText || "Streaming media chunks to platform API..."}
                </p>
              </div>
            ) : null}

            {/* Schedule Post Form */}
            {showScheduleForm ? (
              <form
                onSubmit={handleScheduleSubmit}
                className="flex flex-col gap-2 p-3 border-2 border-court bg-white"
              >
                <p className="text-xs font-bold uppercase tracking-wider text-court">
                  Posting Queue Scheduler
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <label className="flex flex-col text-xs font-semibold">
                    Target Platform
                    <select
                      value={schedulePlatform}
                      onChange={(e) => setSchedulePlatform(e.target.value as Platform | "both")}
                      className="border-2 border-court p-1 mt-1 text-sm bg-paper"
                    >
                      <option value="youtube">YouTube Shorts</option>
                      <option value="instagram">Instagram Reels</option>
                      <option value="both">Both Platforms</option>
                    </select>
                  </label>
                  <label className="flex flex-col text-xs font-semibold">
                    Scheduled Time
                    <input
                      type="datetime-local"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="border-2 border-court p-1 mt-1 text-sm bg-paper"
                    />
                  </label>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={scheduling}
                    className="border-2 border-court bg-volt px-3 py-1 text-xs font-bold hover:bg-volt/80 transition disabled:opacity-60"
                  >
                    {scheduling ? "Scheduling…" : "Confirm Schedule"}
                  </button>
                  {scheduleMsg ? (
                    <span className="text-xs font-semibold text-court">{scheduleMsg}</span>
                  ) : null}
                </div>
              </form>
            ) : null}

            {/* Schedule State Badge */}
            {scheduleState ? (
              <div className="flex items-center gap-2 border border-court/30 bg-volt/20 p-2 text-xs font-semibold text-court">
                <span>📅 Scheduled:</span>
                <span className="font-mono">
                  {new Date(
                    scheduleState.scheduled_at ||
                      scheduleState.publishAt ||
                      scheduleState.published_at ||
                      "",
                  ).toLocaleString()}
                </span>
                <span className="bg-court text-volt px-1.5 py-0.5 text-[10px] font-bold uppercase">
                  {scheduleState.status}
                </span>
              </div>
            ) : null}

            {/* Publishing Results & Errors */}
            {(["youtube", "instagram"] as const).map((p) => {
              const r = publishState[p];
              if (!r) return null;
              return r.status === "published" ? (
                <p key={p} className="text-xs font-semibold text-court">
                  {p === "youtube" ? "YouTube" : "Instagram"}: published{" "}
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer" className="underline font-bold">
                      open post ↗
                    </a>
                  ) : null}
                </p>
              ) : (
                <div
                  key={p}
                  role="alert"
                  className="border-2 border-punch/40 bg-punch/5 p-2.5 text-xs font-semibold text-punch flex flex-col gap-2"
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
                      className="self-start border-2 border-punch bg-white px-2.5 py-1 text-xs font-bold text-punch hover:bg-punch hover:text-white transition disabled:opacity-60"
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
                className="border-2 border-punch/40 bg-punch/5 p-2 text-xs font-bold text-punch"
              >
                {publishError}
              </div>
            ) : null}

            {/* Analytics Loop Card (When published on YouTube or analytics present) */}
            {isYouTubePublished || analytics ? (
              <div className="flex flex-col gap-2 border-2 border-court bg-white p-3">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-court text-xs uppercase tracking-wider">
                    YouTube Performance Analytics
                  </p>
                  <button
                    type="button"
                    disabled={loadingAnalytics}
                    onClick={handleRefreshAnalytics}
                    className="border border-court bg-paper px-2 py-0.5 text-[11px] font-semibold hover:bg-volt transition disabled:opacity-60"
                  >
                    {loadingAnalytics ? "Refreshing…" : "Refresh Stats"}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center pt-1">
                  <div className="border border-court/30 bg-paper/50 p-2">
                    <span className="text-[10px] text-ink/70 uppercase block font-semibold">
                      Views
                    </span>
                    <span className="text-lg font-extrabold text-court">
                      {analytics?.view_count ?? analytics?.views ?? 0}
                    </span>
                  </div>
                  <div className="border border-court/30 bg-paper/50 p-2">
                    <span className="text-[10px] text-ink/70 uppercase block font-semibold">
                      Likes
                    </span>
                    <span className="text-lg font-extrabold text-court">
                      {analytics?.like_count ?? analytics?.likes ?? 0}
                    </span>
                  </div>
                  <div className="border border-court/30 bg-paper/50 p-2">
                    <span className="text-[10px] text-ink/70 uppercase block font-semibold">
                      Comments
                    </span>
                    <span className="text-lg font-extrabold text-court">
                      {analytics?.comment_count ?? analytics?.comments ?? 0}
                    </span>
                  </div>
                </div>
                {(analytics?.retention_seconds || analytics?.retentionSeconds) ? (
                  <p className="text-[11px] text-ink/70">
                    Average retention: {analytics.retention_seconds ?? analytics.retentionSeconds}s
                  </p>
                ) : null}
              </div>
            ) : null}

            <p className="text-xs text-ink/60">
              YouTube uploads default to private (selectable above or via YOUTUBE_PRIVACY in .env). Instagram requires INSTAGRAM_ACCESS_TOKEN.
            </p>
          </div>
        ) : null}

        {/* Card Footer Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t-2 border-court/20">
          <button
            type="button"
            disabled={busy}
            onClick={() => onKeep(!clip.kept)}
            className="border-4 border-court bg-volt px-3 py-2 font-semibold hover:bg-volt/80 transition"
          >
            {clip.kept ? "Drop this clip" : "Keep this clip"}
          </button>

          {hasVideo ? (
            <a
              href={videoSrc}
              download={`${activeTitle.replace(/\s+/g, "_").toLowerCase()}.mp4`}
              className="border-4 border-court bg-punch text-white px-3 py-2 font-semibold hover:bg-punch/90 transition inline-block text-center"
            >
              Download MP4
            </a>
          ) : null}

          {hasCover ? (
            <a
              href={coverSrc}
              download={`${activeTitle.replace(/\s+/g, "_").toLowerCase()}_cover.jpg`}
              className="border-4 border-court bg-white px-3 py-2 font-semibold hover:bg-paper transition inline-block text-center"
            >
              Download Cover JPEG
            </a>
          ) : null}

          <button
            type="button"
            className="border-4 border-court bg-white px-3 py-2 font-semibold hover:bg-paper transition"
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
