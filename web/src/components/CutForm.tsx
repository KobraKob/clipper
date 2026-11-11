"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Divider } from "@astryxdesign/core/Divider";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { Kbd } from "@astryxdesign/core/Kbd";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import {
  FilmGlyph,
  MusicGlyph,
  RefreshGlyph,
  ScissorsGlyph,
  SlidersGlyph,
  SparklesGlyph,
} from "@/components/StudioIcons";
import { createJob, providerNote, uploadSoundtrack, uploadVideo } from "@/lib/api";
import { CAPTION_STYLE_OPTIONS, type CaptionCategory } from "@/lib/captionStyles";
import type { Layout, Provider, SocialTemplate, VideoEncoder } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Types and constants                                                 */
/* ------------------------------------------------------------------ */

type CaptionOption = (typeof CAPTION_STYLE_OPTIONS)[number];

type Settings = {
  clipCount: number;
  provider: Provider;
  vertical: boolean;
  captions: boolean;
  captionStyle: string;
  captionCategory: "all" | CaptionCategory;
  layout: Layout;
  template: SocialTemplate;
  templateDisplayName: string;
  templateHandle: string;
  videoEncoder: VideoEncoder;
  hookOverlay: boolean;
  loudnorm: boolean;
  trimSilence: boolean;
  progressBar: boolean;
  soundtrackVolume: number;
};

const DEFAULTS: Settings = {
  clipCount: 5,
  provider: "local",
  vertical: true,
  captions: true,
  captionStyle: "bold_pop",
  captionCategory: "all",
  layout: "fill",
  template: "none",
  templateDisplayName: "Your Name",
  templateHandle: "@yourhandle",
  videoEncoder: "auto",
  hookOverlay: true,
  loudnorm: true,
  trimSilence: false,
  progressBar: false,
  soundtrackVolume: 0.18,
};

const STORAGE_KEY = "cutform.settings.v1";
const MAX_VIDEO_BYTES = 8 * 1024 * 1024 * 1024; // 8 GB safety cap in browser dropzone
const MAX_SOUNDTRACK_BYTES = 100 * 1024 * 1024;

const SECTIONS = [
  { id: "source", label: "Source" },
  { id: "format", label: "Format" },
  { id: "captions", label: "Captions" },
  { id: "audio", label: "Audio" },
  { id: "processing", label: "Processing" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const LAYOUTS: { value: Layout; label: string; note: string }[] = [
  { value: "fill", label: "Fill 9:16", note: "Face-tracked vertical crop" },
  { value: "fit_blur", label: "Fit + blur", note: "Full frame on blurred backdrop" },
  { value: "split_screen", label: "Split", note: "Dual stacked speakers" },
];

const SOCIAL_TEMPLATES: { value: SocialTemplate; label: string; note: string }[] = [
  { value: "none", label: "Clean 9:16", note: "Full bleed vertical video without card framing." },
  { value: "x", label: "X Post", note: "Author header, post title, video frame, and metrics bar." },
  { value: "instagram", label: "Instagram", note: "Reel header bar, action row, caption, and hashtags." },
  { value: "headline", label: "Headline", note: "Bold editorial banner, video frame, and pull-quote footer." },
];

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: "local", label: "Local" },
  { value: "groq", label: "Groq" },
  { value: "openrouter", label: "OpenRouter" },
];

const ENCODERS: { value: VideoEncoder; label: string; description: string }[] = [
  { value: "auto", label: "Auto (recommended)", description: "NVENC GPU preferred with CPU fallback" },
  { value: "h264_nvenc", label: "NVIDIA NVENC", description: "Hardware GPU encode on RTX/GTX cards" },
  { value: "libx264", label: "CPU (libx264)", description: "Universal software encoder" },
  { value: "h264_qsv", label: "Intel QSV", description: "Intel Quick Sync hardware encode" },
];

const VOLUMES: { value: string; num: number; label: string; note: string }[] = [
  { value: "0.12", num: 0.12, label: "12%", note: "Subtle" },
  { value: "0.18", num: 0.18, label: "18%", note: "Balanced" },
  { value: "0.25", num: 0.25, label: "25%", note: "Noticeable" },
  { value: "0.32", num: 0.32, label: "32%", note: "Loud" },
];

const CATEGORY_FILTERS: { value: "all" | CaptionCategory; label: string }[] = [
  { value: "all", label: "All" },
  { value: "bold", label: "Bold" },
  { value: "minimal", label: "Minimal" },
  { value: "creative", label: "Creative" },
];

const PRESETS: { id: string; label: string; note: string; patch: Partial<Settings> }[] = [
  {
    id: "talking-head",
    label: "Talking head",
    note: "9:16 face-track, tight pacing, hook bar",
    patch: { vertical: true, layout: "fill", trimSilence: true, hookOverlay: true },
  },
  {
    id: "two-speakers",
    label: "Two speakers",
    note: "Split vertical stack + silence trim",
    patch: { vertical: true, layout: "split_screen", trimSilence: true, hookOverlay: true },
  },
  {
    id: "screen",
    label: "Slides / screen",
    note: "Fit with blur backdrop, no crop loss",
    patch: { vertical: true, layout: "fit_blur", trimSilence: false, hookOverlay: false },
  },
  {
    id: "widescreen",
    label: "Widescreen 16:9",
    note: "Keep original horizontal aspect",
    patch: { vertical: false },
  },
];

const VIDEO_EXT = /\.(mp4|mov|mkv|webm|m4v|avi)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isVideoFile(file: File) {
  return file.type.startsWith("video/") || VIDEO_EXT.test(file.name);
}

function isAudioFile(file: File) {
  return file.type.startsWith("audio/") || AUDIO_EXT.test(file.name);
}

function describeSource(value: string, uploadedName: string) {
  const v = value.trim();
  if (!v) return null;
  if (uploadedName) return "Uploaded file";
  if (/^https?:\/\//i.test(v)) {
    try {
      const host = new URL(v).hostname.replace(/^www\./, "");
      return /(^|\.)youtube\.com$|^youtu\.be$/.test(host) ? "YouTube link" : "Web link";
    } catch {
      return "Invalid link";
    }
  }
  if (/^(www\.|youtu\.be|youtube\.com)/i.test(v)) return "Invalid link";
  return "Local file path";
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ------------------------------------------------------------------ */
/* Vector Live Previews (zero divs/inline styles)                      */
/* ------------------------------------------------------------------ */

function CaptionSwatchSvg({ option }: { option: CaptionOption }) {
  const words = option.upper ? ["STOP", "SCROLLING"] : ["Stop", "scrolling"];
  return (
    <svg
      viewBox="0 0 180 34"
      className="h-8 w-36 shrink-0 rounded-md bg-body/80"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="180" height="34" rx="6" fill="currentColor" opacity="0.18" />
      <text
        x="52"
        y="22"
        textAnchor="middle"
        fill={option.base}
        stroke={option.stroke}
        strokeWidth="2.5"
        paintOrder="stroke"
        fontSize="12"
        fontWeight="800"
      >
        {words[0]}
      </text>
      {option.activeBg ? (
        <rect x="86" y="7" width="78" height="20" rx="4" fill={option.activeBg} />
      ) : null}
      <text
        x="125"
        y="22"
        textAnchor="middle"
        fill={option.active}
        stroke={option.activeBg ? "none" : option.stroke}
        strokeWidth="2.5"
        paintOrder="stroke"
        fontSize="12"
        fontWeight="800"
      >
        {words[1]}
      </text>
    </svg>
  );
}

function FramePreviewSvg({
  vertical,
  layout,
  template,
  templateDisplayName,
  templateHandle,
  captions,
  hookOverlay,
  progressBar,
  option,
}: {
  vertical: boolean;
  layout: Layout;
  template: SocialTemplate;
  templateDisplayName: string;
  templateHandle: string;
  captions: boolean;
  hookOverlay: boolean;
  progressBar: boolean;
  option: CaptionOption;
}) {
  const w = vertical ? 180 : 280;
  const h = vertical ? 320 : 158;
  const label = `Live frame preview: ${vertical ? layout : "16:9 widescreen"}${
    vertical && template !== "none" ? `, ${template} card` : ""
  }, ${captions ? `${option.label} captions` : "captions off"}`;

  const displayName = templateDisplayName.trim() || "Your Name";
  const handle = templateHandle.trim() || "@yourhandle";
  const words = option.upper ? ["WATCH", "THIS", "CLIP"] : ["Watch", "this", "clip"];

  const renderFace = (cx: number, cy: number, r: number) => (
    <g opacity="0.85">
      <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
      <circle cx={cx} cy={cy - r * 0.16} r={r * 0.34} fill="rgba(255,255,255,0.72)" />
      <path
        d={`M ${cx - r * 0.45} ${cy + r * 0.56} Q ${cx} ${cy + r * 0.18} ${cx + r * 0.45} ${cy + r * 0.56}`}
        fill="rgba(255,255,255,0.58)"
      />
    </g>
  );

  const captionY = vertical ? 248 : 132;
  const cx = w / 2;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${w} ${h}`}
      className={vertical ? "mx-auto h-64 w-36 rounded-xl" : "mx-auto h-36 w-64 rounded-xl"}
    >
      <rect x="1" y="1" width={w - 2} height={h - 2} rx="14" fill="#090b12" stroke="rgba(255,255,255,0.2)" strokeWidth="2" />

      {!vertical ? (
        <>
          <rect x="8" y="8" width={w - 16} height={h - 16} rx="10" fill="rgba(255,255,255,0.06)" />
          {renderFace(cx, 70, 24)}
        </>
      ) : template === "x" ? (
        <>
          <rect x="12" y="16" width={w - 24} height="54" rx="8" fill="rgba(255,255,255,0.06)" />
          <circle cx="28" cy="34" r="9" fill="rgba(255,255,255,0.28)" />
          <text x="43" y="33" fill="#f8fafc" fontSize="9" fontWeight="700">
            {displayName.slice(0, 18)}
          </text>
          <text x="43" y="44" fill="#94a3b8" fontSize="7.5">
            {handle.slice(0, 20)}
          </text>
          <text x="20" y="61" fill="#e2e8f0" fontSize="8" fontWeight="600">
            Your viral clip hook goes here
          </text>
          <rect x="12" y="78" width={w - 24} height="176" rx="10" fill="rgba(255,255,255,0.09)" />
          {renderFace(cx, 150, 26)}
          <text x="22" y="278" fill="#94a3b8" fontSize="8">
            1.4K replies · 8.2K reposts · 49K likes
          </text>
        </>
      ) : template === "instagram" ? (
        <>
          <rect x="12" y="16" width={w - 24} height="34" rx="8" fill="rgba(255,255,255,0.06)" />
          <circle cx="28" cy="33" r="8" fill="rgba(255,255,255,0.28)" />
          <text x="42" y="36" fill="#f8fafc" fontSize="8.5" fontWeight="700">
            {handle.replace(/^@/, "").slice(0, 18)}
          </text>
          <rect x="12" y="56" width={w - 24} height="196" rx="10" fill="rgba(255,255,255,0.09)" />
          {renderFace(cx, 140, 28)}
          <text x="20" y="274" fill="#e2e8f0" fontSize="8" fontWeight="700">
            {handle.replace(/^@/, "").slice(0, 14)}
          </text>
          <text x="20" y="288" fill="#94a3b8" fontSize="7.5">
            Your reel caption &amp; #tags
          </text>
        </>
      ) : template === "headline" ? (
        <>
          <rect x="12" y="16" width={w - 24} height="62" rx="8" fill="#facc15" />
          <text x="20" y="34" fill="#090b12" fontSize="7" fontWeight="800" letterSpacing="0.8">
            KEY INSIGHT
          </text>
          <text x="20" y="51" fill="#090b12" fontSize="11" fontWeight="900">
            THE IDEA THAT CHANGED
          </text>
          <text x="20" y="65" fill="#090b12" fontSize="11" fontWeight="900">
            EVERYTHING
          </text>
          <rect x="12" y="86" width={w - 24} height="168" rx="10" fill="rgba(255,255,255,0.09)" />
          {renderFace(cx, 158, 26)}
          <text x="20" y="276" fill="#e2e8f0" fontSize="7.5" fontWeight="600">
            “Your strongest clip quote.”
          </text>
        </>
      ) : layout === "split_screen" ? (
        <>
          <rect x="10" y="10" width={w - 20} height="146" rx="10" fill="rgba(255,255,255,0.08)" />
          {renderFace(cx, 82, 26)}
          <rect x="10" y="162" width={w - 20} height="148" rx="10" fill="rgba(255,255,255,0.06)" />
          {renderFace(cx, 232, 24)}
        </>
      ) : layout === "fit_blur" ? (
        <>
          <rect x="10" y="10" width={w - 20} height={h - 20} rx="10" fill="rgba(99,102,241,0.12)" />
          <rect x="10" y="108" width={w - 20} height="92" rx="4" fill="rgba(255,255,255,0.12)" />
          {renderFace(cx, 154, 22)}
        </>
      ) : (
        <>
          <rect x="10" y="10" width={w - 20} height={h - 20} rx="10" fill="rgba(255,255,255,0.07)" />
          {renderFace(cx, 126, 36)}
        </>
      )}

      {hookOverlay && (!vertical || template === "none") ? (
        <rect x="24" y="20" width={w - 48} height="14" rx="4" fill="rgba(255,255,255,0.78)" />
      ) : null}

      {captions ? (
        <g>
          {option.activeBg ? (
            <rect
              x={cx - 10}
              y={captionY - 13}
              width="52"
              height="18"
              rx="4"
              fill={option.activeBg}
            />
          ) : null}
          <text
            x={cx - 42}
            y={captionY}
            textAnchor="middle"
            fill={option.base}
            stroke={option.stroke}
            strokeWidth="2.5"
            paintOrder="stroke"
            fontSize="11"
            fontWeight="900"
          >
            {words[0]}
          </text>
          <text
            x={cx + 15}
            y={captionY}
            textAnchor="middle"
            fill={option.active}
            stroke={option.activeBg ? "none" : option.stroke}
            strokeWidth="2.5"
            paintOrder="stroke"
            fontSize="11"
            fontWeight="900"
          >
            {words[1]}
          </text>
          <text
            x={cx + 58}
            y={captionY}
            textAnchor="middle"
            fill={option.base}
            stroke={option.stroke}
            strokeWidth="2.5"
            paintOrder="stroke"
            fontSize="11"
            fontWeight="900"
          >
            {words[2]}
          </text>
        </g>
      ) : null}

      {progressBar ? (
        <rect x="10" y={h - 14} width={(w - 20) * 0.45} height="4" rx="2" fill="#6366f1" />
      ) : null}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function CutForm() {
  const router = useRouter();
  const toast = useToast();

  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const hasLoadedStorageRef = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Settings>;
        const next = { ...DEFAULTS, ...saved };
        if (!CAPTION_STYLE_OPTIONS.some((o) => o.key === next.captionStyle)) next.captionStyle = DEFAULTS.captionStyle;
        if (!SOCIAL_TEMPLATES.some((o) => o.value === next.template)) next.template = DEFAULTS.template;
        next.templateDisplayName = String(next.templateDisplayName || DEFAULTS.templateDisplayName).slice(0, 40);
        next.templateHandle = String(next.templateHandle || DEFAULTS.templateHandle).replace(/\s+/g, "").slice(0, 32);
        if (next.templateHandle && !next.templateHandle.startsWith("@")) {
          next.templateHandle = "@" + next.templateHandle.replace(/^@+/, "");
        }
        next.clipCount = clamp(Number(next.clipCount) || DEFAULTS.clipCount, 1, 10);
        queueMicrotask(() => {
          setSettings(next);
        });
      }
    } catch {
      /* storage unavailable or corrupt */
    } finally {
      hasLoadedStorageRef.current = true;
    }
  }, []);

  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [uploadedName, setUploadedName] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");

  const [soundtrackFile, setSoundtrackFile] = useState<File | null>(null);
  const [soundtrackPath, setSoundtrackPath] = useState("");
  const [soundtrackName, setSoundtrackName] = useState("");
  const [soundtrackError, setSoundtrackError] = useState("");
  const [uploadingSoundtrack, setUploadingSoundtrack] = useState(false);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [processingOpen, setProcessingOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>("source");

  const formRef = useRef<HTMLFormElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);

  const patch = (next: Partial<Settings>) => setSettings((prev) => ({ ...prev, ...next }));

  const selectedOption =
    CAPTION_STYLE_OPTIONS.find((o) => o.key === settings.captionStyle) || CAPTION_STYLE_OPTIONS[0];
  const layoutLabel = LAYOUTS.find((l) => l.value === settings.layout)?.label ?? "Fill 9:16";
  const providerLabel = PROVIDERS.find((p) => p.value === settings.provider)?.label ?? settings.provider;
  const encoderLabel = ENCODERS.find((e) => e.value === settings.videoEncoder)?.label ?? settings.videoEncoder;
  const volumeLabel = VOLUMES.find((v) => v.num === settings.soundtrackVolume);
  const sourceKind = describeSource(sourceUrl, uploadedName);
  const working = busy || uploading || uploadingSoundtrack;

  const visibleOptions = useMemo(
    () =>
      CAPTION_STYLE_OPTIONS.filter(
        (o) => settings.captionCategory === "all" || o.category === settings.captionCategory,
      ),
    [settings.captionCategory],
  );

  const enabledExtras = [
    settings.hookOverlay && "Hook bar",
    settings.loudnorm && "Loudness",
    settings.trimSilence && "Silence trim",
    settings.progressBar && "Progress bar",
  ].filter(Boolean) as string[];

  useEffect(() => {
    if (!hydrated || !hasLoadedStorageRef.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* storage full or blocked */
    }
  }, [settings, hydrated]);

  /* Scroll-spy section tabs */
  useEffect(() => {
    const targets = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => !!el,
    );
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (first) setActiveSection(first.target.id as SectionId);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (error) {
      document.getElementById("cutform-error-card")?.scrollIntoView({
        block: "center",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
  }, [error]);

  function goTo(id: SectionId) {
    setActiveSection(id);
    if (id === "processing") setProcessingOpen(true);
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      });
    });
  }

  function presetActive(preset: (typeof PRESETS)[number]) {
    return (Object.keys(preset.patch) as (keyof Settings)[]).every((key) => settings[key] === preset.patch[key]);
  }

  function resetSettings() {
    setSettings(DEFAULTS);
    toast({ body: "Cut settings reset to defaults.", uniqueID: "cutform-reset" });
  }

  /* Source handlers */
  function changeSourceUrl(value: string) {
    setSourceUrl(value);
    setSourceError("");
    if (uploadedName || sourceFile) {
      setUploadedName("");
      setSourceFile(null);
      setUploadStatus("");
    }
  }

  async function pasteSource() {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        changeSourceUrl(text.trim());
        toast({ body: "Pasted source link from clipboard.", uniqueID: "cutform-paste" });
      } else {
        toast({ body: "Clipboard has no link text.", type: "info", uniqueID: "cutform-paste-empty" });
      }
    } catch {
      toast({
        body: "Clipboard access blocked — paste directly into the field.",
        type: "info",
        uniqueID: "cutform-paste-denied",
      });
    }
    sourceInputRef.current?.focus();
  }

  async function handleSourceFileChange(files: File | File[] | null) {
    const file = Array.isArray(files) ? (files[0] ?? null) : files;
    if (!file) {
      setSourceFile(null);
      if (uploadedName) {
        setUploadedName("");
        setSourceUrl("");
        setUploadStatus("");
      }
      return;
    }
    if (!isVideoFile(file)) {
      setSourceError("Unsupported file type. Use MP4, MOV, MKV, WebM, M4V, or AVI.");
      setSourceFile(null);
      return;
    }
    setError("");
    setSourceError("");
    setSourceFile(file);
    setUploading(true);
    setUploadStatus(`Uploading ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`);
    try {
      const result = await uploadVideo(file);
      setSourceUrl(result.path);
      setUploadedName(file.name);
      setUploadStatus("");
      toast({ body: `Uploaded ${file.name}`, uniqueID: "cutform-video-upload" });
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : "Upload failed. Try again.");
      setSourceFile(null);
      setUploadStatus("");
    } finally {
      setUploading(false);
    }
  }

  /* Soundtrack handlers */
  async function handleSoundtrackChange(files: File | File[] | null) {
    const file = Array.isArray(files) ? (files[0] ?? null) : files;
    if (!file) {
      setSoundtrackFile(null);
      setSoundtrackPath("");
      setSoundtrackName("");
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
    setUploadingSoundtrack(true);
    try {
      const uploaded = await uploadSoundtrack(file);
      setSoundtrackPath(uploaded.path);
      setSoundtrackName(file.name);
      toast({ body: `Soundtrack attached: ${file.name}`, uniqueID: "cutform-audio-upload" });
    } catch (err) {
      setSoundtrackError(err instanceof Error ? err.message : "Soundtrack upload failed. Try again.");
      setSoundtrackFile(null);
    } finally {
      setUploadingSoundtrack(false);
    }
  }

  /* Submit */
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (working) return;
    setError("");

    const trimmed = sourceUrl.trim();
    if (!trimmed) {
      setSourceError("Add a video link, upload a video file, or enter a local file path.");
      goTo("source");
      sourceInputRef.current?.focus();
      return;
    }
    if (describeSource(trimmed, uploadedName) === "Invalid link") {
      setSourceError("That URL looks incomplete. Start it with https:// and verify the domain.");
      goTo("source");
      sourceInputRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const job = await createJob({
        sourceUrl: trimmed,
        clipCount: settings.clipCount,
        provider: settings.provider,
        vertical: settings.vertical,
        captions: settings.captions,
        captionStyle: settings.captionStyle,
        layout: settings.layout,
        template: settings.template,
        templateDisplayName: settings.templateDisplayName,
        templateHandle: settings.templateHandle,
        videoEncoder: settings.videoEncoder,
        trimSilence: settings.trimSilence,
        hookOverlay: settings.hookOverlay,
        progressBar: settings.progressBar,
        loudnorm: settings.loudnorm,
        soundtrackPath: soundtrackPath || undefined,
        soundtrackVolume: settings.soundtrackVolume,
      });
      toast({ body: "Cut launched — opening job studio.", uniqueID: "cutform-launch" });
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the cut. Try again.");
      setBusy(false);
    }
  }

  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter" || working) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.closest('[role="dialog"]'))) {
        return;
      }
      e.preventDefault();
      formRef.current?.requestSubmit();
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [working]);

  function onFormKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !working) {
      e.preventDefault();
      e.currentTarget.requestSubmit();
    }
  }

  const ctaLabel = uploading
    ? "Uploading video…"
    : uploadingSoundtrack
      ? "Uploading audio…"
      : busy
        ? "Launching cut…"
        : `Cut ${settings.clipCount} ${settings.clipCount === 1 ? "clip" : "clips"}`;

  return (
    <form ref={formRef} onSubmit={onSubmit} onKeyDown={onFormKeyDown} noValidate>
      <VStack gap={6}>
        {/* Top jump tabs */}
        <TabList
          value={activeSection}
          onChange={(val) => goTo(val as SectionId)}
          aria-label="Cut configuration sections"
          hasDivider
          size="sm"
        >
          {SECTIONS.map((s) => (
            <Tab key={s.id} value={s.id} label={s.label} />
          ))}
        </TabList>

        {error ? (
          <Card id="cutform-error-card" padding={0} variant="default">
            <Banner
              status="error"
              title="Could not start cut"
              description={error}
              isDismissable
              onDismiss={() => setError("")}
            />
          </Card>
        ) : null}

        <HStack gap={6} align="start" wrap="wrap">
          {/* Left 2 columns: Configuration Sections */}
          <VStack gap={6} className="min-w-0 flex-[2_1_560px]">
              {/* 1. Source */}
              <Card id="source" padding={6} variant="default" className="scroll-mt-24">
                <VStack gap={5}>
                  <HStack justify="between" align="center" wrap="wrap" gap={2}>
                    <VStack gap={1}>
                      <Heading level={2} type="display-3">
                        1. Source footage
                      </Heading>
                      <Text type="supporting" color="secondary">
                        Paste a YouTube / web link, enter a server path, or upload a video file directly.
                      </Text>
                    </VStack>
                    {sourceKind ? (
                      <HStack gap={1.5} align="center">
                        <StatusDot
                          variant={sourceKind === "Invalid link" ? "error" : "success"}
                          label={sourceKind}
                        />
                        <Badge
                          label={sourceKind}
                          variant={sourceKind === "Invalid link" ? "error" : "info"}
                        />
                      </HStack>
                    ) : null}
                  </HStack>

                  <HStack gap={2} align="end">
                    <TextInput
                      ref={sourceInputRef}
                      label="Video link or path"
                      placeholder="https://youtube.com/watch?v=... or C:\videos\episode.mp4"
                      value={sourceUrl}
                      onChange={changeSourceUrl}
                      startIcon={<Icon icon={FilmGlyph} />}
                      hasClear
                      width="100%"
                      isRequired
                      isDisabled={uploading || busy}
                      status={sourceError ? { type: "error", message: sourceError } : undefined}
                    />
                    <Button
                      label="Paste"
                      variant="secondary"
                      icon={<Icon icon="copy" />}
                      onClick={pasteSource}
                      isDisabled={uploading || busy}
                    />
                  </HStack>

                  <Divider label="or upload a local video" />

                  <FileInput
                    label="Upload video file"
                    description={
                      uploadedName
                        ? `Uploaded: ${uploadedName}`
                        : "Supports MP4, MOV, MKV, WebM, M4V, and AVI. Streams directly to the pipeline workspace."
                    }
                    mode="dropzone"
                    accept="video/*,.mp4,.mov,.mkv,.webm,.m4v,.avi"
                    maxSize={MAX_VIDEO_BYTES}
                    value={sourceFile}
                    onChange={(files) => void handleSourceFileChange(files)}
                    isLoading={uploading}
                    isDisabled={busy}
                    placeholder="Drop video here or browse files"
                    status={
                      uploading
                        ? { type: "warning", message: uploadStatus || "Uploading video..." }
                        : uploadedName
                          ? { type: "success", message: `Ready: ${uploadedName}` }
                          : undefined
                    }
                    statusVariant="detached"
                  />

                  {uploading ? (
                    <ProgressBar
                      label="Uploading video"
                      isIndeterminate
                      variant="accent"
                    />
                  ) : null}
                </VStack>
              </Card>

              {/* 2. Format & Framing */}
              <Card id="format" padding={6} variant="default" className="scroll-mt-24">
                <VStack gap={5}>
                  <VStack gap={1}>
                    <Heading level={2} type="display-3">
                      2. Format &amp; framing
                    </Heading>
                    <Text type="supporting" color="secondary">
                      Choose how many clips to extract, aspect ratio, crop layout, and optional social framing.
                    </Text>
                  </VStack>

                  {/* Quick presets */}
                  <VStack gap={2}>
                    <Text type="label" color="secondary">
                      QUICK PRESETS
                    </Text>
                    <Grid columns={{ minWidth: 160, max: 2 }} gap={2}>
                      {PRESETS.map((preset) => {
                        const active = presetActive(preset);
                        return (
                          <Button
                            key={preset.id}
                            label={preset.label}
                            variant={active ? "primary" : "secondary"}
                            size="sm"
                            onClick={() => {
                              patch(preset.patch);
                              toast({ body: `Applied "${preset.label}" preset.`, uniqueID: "cutform-preset" });
                            }}
                          />
                        );
                      })}
                    </Grid>
                  </VStack>

                  <Divider />

                  <Grid columns={{ minWidth: 200, max: 2 }} gap={4} align="end">
                    <NumberInput
                      label="Number of clips"
                      description="1 to 10 highest-scoring moments"
                      value={settings.clipCount}
                      onChange={(v) => patch({ clipCount: clamp(Math.round(v || 1), 1, 10) })}
                      min={1}
                      max={10}
                      step={1}
                      isIntegerOnly
                      hasNumberSteppers
                      units="clips"
                      width="100%"
                    />

                    <Card padding={3} variant="muted">
                      <Switch
                        label="Vertical 9:16"
                        description="Reframe for Reels, Shorts &amp; TikTok"
                        value={settings.vertical}
                        onChange={(checked) => patch({ vertical: checked })}
                        labelSpacing="spread"
                        width="100%"
                      />
                    </Card>
                  </Grid>

                  {settings.vertical ? (
                    <VStack gap={4}>
                      <SegmentedControl
                        label="Vertical crop layout"
                        value={settings.layout}
                        onChange={(val) => patch({ layout: val as Layout })}
                        layout="fill"
                      >
                        {LAYOUTS.map((l) => (
                          <SegmentedControlItem key={l.value} value={l.value} label={l.label} />
                        ))}
                      </SegmentedControl>

                      <SegmentedControl
                        label="Social card template"
                        value={settings.template}
                        onChange={(val) => patch({ template: val as SocialTemplate })}
                        layout="fill"
                      >
                        {SOCIAL_TEMPLATES.map((t) => (
                          <SegmentedControlItem key={t.value} value={t.value} label={t.label} />
                        ))}
                      </SegmentedControl>

                      {settings.template === "x" || settings.template === "instagram" ? (
                        <Grid columns={{ minWidth: 180, max: 2 }} gap={3}>
                          <TextInput
                            label="Display name"
                            value={settings.templateDisplayName}
                            onChange={(val) => patch({ templateDisplayName: val.slice(0, 40) })}
                            placeholder="Your Name"
                            width="100%"
                          />
                          <TextInput
                            label="Handle"
                            value={settings.templateHandle}
                            onChange={(val) => {
                              const cleaned = val.replace(/\s+/g, "").slice(0, 32);
                              patch({
                                templateHandle:
                                  cleaned && !cleaned.startsWith("@")
                                    ? "@" + cleaned.replace(/^@+/, "")
                                    : cleaned,
                              });
                            }}
                            placeholder="@yourhandle"
                            width="100%"
                          />
                        </Grid>
                      ) : null}
                    </VStack>
                  ) : null}
                </VStack>
              </Card>

              {/* 3. Captions */}
              <Card id="captions" padding={6} variant="default" className="scroll-mt-24">
                <VStack gap={5}>
                  <HStack justify="between" align="center" wrap="wrap" gap={3}>
                    <VStack gap={1}>
                      <Heading level={2} type="display-3">
                        3. Burned-in captions
                      </Heading>
                      <Text type="supporting" color="secondary">
                        Word-level karaoke timing rendered directly onto each clip.
                      </Text>
                    </VStack>

                    <Switch
                      label="Enable captions"
                      value={settings.captions}
                      onChange={(checked) => patch({ captions: checked })}
                    />
                  </HStack>

                  {settings.captions ? (
                    <VStack gap={4}>
                      <SegmentedControl
                        label="Filter caption styles"
                        value={settings.captionCategory}
                        onChange={(val) => patch({ captionCategory: val as "all" | CaptionCategory })}
                        size="sm"
                      >
                        {CATEGORY_FILTERS.map((cat) => (
                          <SegmentedControlItem key={cat.value} value={cat.value} label={cat.label} />
                        ))}
                      </SegmentedControl>

                      <RadioList
                        label="Caption preset"
                        value={settings.captionStyle}
                        onChange={(val) => patch({ captionStyle: val })}
                        width="100%"
                      >
                        {visibleOptions.map((option) => (
                          <RadioListItem
                            key={option.key}
                            value={option.key}
                            label={option.label}
                            description={option.description}
                            startContent={<CaptionSwatchSvg option={option} />}
                            endContent={<Badge label={option.category} variant="neutral" />}
                          />
                        ))}
                      </RadioList>
                    </VStack>
                  ) : (
                    <Banner
                      status="info"
                      title="Captions disabled"
                      description="Clips will export clean without burned-in subtitles. You can re-render any clip with captions later inside the Job Studio."
                    />
                  )}
                </VStack>
              </Card>

              {/* 4. Audio */}
              <Card id="audio" padding={6} variant="default" className="scroll-mt-24">
                <VStack gap={5}>
                  <HStack gap={2} align="center">
                    <Icon icon={MusicGlyph} size="sm" color="accent" />
                    <Heading level={2} type="display-3">
                      4. Audio &amp; soundtrack
                    </Heading>
                  </HStack>

                  <Card padding={3} variant="muted">
                    <Switch
                      label="Loudness normalization (-14 LUFS)"
                      description="Balances spoken dialogue to platform loudness targets before export."
                      value={settings.loudnorm}
                      onChange={(checked) => patch({ loudnorm: checked })}
                      labelSpacing="spread"
                      width="100%"
                    />
                  </Card>

                  <FileInput
                    label="Background soundtrack (optional)"
                    description={
                      soundtrackName
                        ? `Attached: ${soundtrackName}`
                        : "MP3, WAV, M4A, AAC, OGG, or FLAC up to 100 MB. Mixed under dialogue."
                    }
                    mode="dropzone"
                    accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                    maxSize={MAX_SOUNDTRACK_BYTES}
                    value={soundtrackFile}
                    onChange={(files) => void handleSoundtrackChange(files)}
                    isLoading={uploadingSoundtrack}
                    isDisabled={busy}
                    isOptional
                    placeholder="Drop background music track or browse"
                    status={
                      soundtrackError
                        ? { type: "error", message: soundtrackError }
                        : soundtrackName
                          ? { type: "success", message: `Attached: ${soundtrackName}` }
                          : undefined
                    }
                    statusVariant="detached"
                  />

                  {soundtrackName ? (
                    <SegmentedControl
                      label="Soundtrack mix level"
                      value={String(settings.soundtrackVolume)}
                      onChange={(val) => patch({ soundtrackVolume: Number(val) })}
                      layout="fill"
                    >
                      {VOLUMES.map((vol) => (
                        <SegmentedControlItem
                          key={vol.value}
                          value={vol.value}
                          label={`${vol.note} (${vol.label})`}
                        />
                      ))}
                    </SegmentedControl>
                  ) : null}
                </VStack>
              </Card>

              {/* 5. Processing & Engine */}
              <Card id="processing" padding={6} variant="default" className="scroll-mt-24">
                <Collapsible
                  isOpen={processingOpen}
                  onOpenChange={setProcessingOpen}
                  trigger={
                    <HStack gap={2} align="center">
                      <Icon icon={SlidersGlyph} size="sm" color="accent" />
                      <Heading level={2} type="display-3">
                        5. Engine &amp; enhancements
                      </Heading>
                    </HStack>
                  }
                >
                  <VStack gap={5} paddingBlockStart={4}>
                    <SegmentedControl
                      label="AI scoring &amp; metadata provider"
                      value={settings.provider}
                      onChange={(val) => patch({ provider: val as Provider })}
                      layout="fill"
                    >
                      {PROVIDERS.map((p) => (
                        <SegmentedControlItem key={p.value} value={p.value} label={p.label} />
                      ))}
                    </SegmentedControl>
                    <Text type="supporting" color="secondary">
                      {providerNote(settings.provider)}
                    </Text>

                    <Selector
                      label="Video encoder"
                      description="Select hardware acceleration or universal software encoding."
                      value={settings.videoEncoder}
                      onChange={(val) => patch({ videoEncoder: val as VideoEncoder })}
                      options={ENCODERS.map((enc) => ({
                        value: enc.value,
                        label: enc.label,
                        description: enc.description,
                      }))}
                      width="100%"
                    />

                    <Grid columns={{ minWidth: 200, max: 3 }} gap={3}>
                      <Card padding={3} variant="muted">
                        <Switch
                          label="Hook overlay"
                          description="Show opening hook bar"
                          value={settings.hookOverlay}
                          onChange={(checked) => patch({ hookOverlay: checked })}
                          labelSpacing="spread"
                          width="100%"
                        />
                      </Card>
                      <Card padding={3} variant="muted">
                        <Switch
                          label="Trim silences"
                          description="Tighten dead air pauses"
                          value={settings.trimSilence}
                          onChange={(checked) => patch({ trimSilence: checked })}
                          labelSpacing="spread"
                          width="100%"
                        />
                      </Card>
                      <Card padding={3} variant="muted">
                        <Switch
                          label="Progress bar"
                          description="Bottom retention bar"
                          value={settings.progressBar}
                          onChange={(checked) => patch({ progressBar: checked })}
                          labelSpacing="spread"
                          width="100%"
                        />
                      </Card>
                    </Grid>

                    <HStack justify="end">
                      <Button
                        label="Reset all defaults"
                        variant="ghost"
                        size="sm"
                        icon={<Icon icon={RefreshGlyph} />}
                        onClick={resetSettings}
                      />
                    </HStack>
                  </VStack>
                </Collapsible>
              </Card>
          </VStack>

          {/* Right sticky rail: Live Preview & Launch Summary */}
          <VStack className="w-full min-w-0 flex-[1_1_340px] lg:sticky lg:top-20">
            <Card padding={5} variant="muted" elevation="low">
            <VStack gap={5}>
              <HStack justify="between" align="center">
                <HStack gap={2} align="center">
                  <Icon icon={SparklesGlyph} size="sm" color="accent" />
                  <Text type="label" color="accent">
                    LIVE FRAME PREVIEW
                  </Text>
                </HStack>
                <Badge label={settings.vertical ? "9:16" : "16:9"} variant="info" />
              </HStack>

              <FramePreviewSvg
                vertical={settings.vertical}
                layout={settings.layout}
                template={settings.template}
                templateDisplayName={settings.templateDisplayName}
                templateHandle={settings.templateHandle}
                captions={settings.captions}
                hookOverlay={settings.hookOverlay}
                progressBar={settings.progressBar}
                option={selectedOption}
              />

              <Divider label="Run summary" />

              <MetadataList title="Cut configuration summary" orientation="vertical" label={{ position: "start" }}>
                <MetadataListItem label="Source">
                  <HStack gap={2} align="center" justify="between" width="100%">
                    <Text type="supporting">{sourceKind ?? "Not set"}</Text>
                    <Button
                      label="Edit"
                      variant="ghost"
                      size="sm"
                      onClick={() => goTo("source")}
                    />
                  </HStack>
                </MetadataListItem>
                <MetadataListItem label="Output">
                  <Text type="supporting">
                    {`${settings.clipCount} ${settings.clipCount === 1 ? "clip" : "clips"} · ${
                      settings.vertical ? layoutLabel : "Widescreen"
                    }`}
                  </Text>
                </MetadataListItem>
                <MetadataListItem label="Captions">
                  <Text type="supporting">{settings.captions ? selectedOption.label : "Off"}</Text>
                </MetadataListItem>
                <MetadataListItem label="Audio">
                  <Text type="supporting">
                    {soundtrackName
                      ? `${soundtrackName} (${volumeLabel?.label ?? "18%"})`
                      : settings.loudnorm
                        ? "Loudness -14 LUFS"
                        : "Original audio"}
                  </Text>
                </MetadataListItem>
                <MetadataListItem label="Engine">
                  <Text type="supporting">{`${providerLabel} · ${encoderLabel}`}</Text>
                </MetadataListItem>
                {enabledExtras.length > 0 ? (
                  <MetadataListItem label="Extras">
                    <Text type="supporting">{enabledExtras.join(", ")}</Text>
                  </MetadataListItem>
                ) : null}
              </MetadataList>

              <VStack gap={2}>
                <Button
                  type="submit"
                  label={ctaLabel}
                  variant="primary"
                  size="lg"
                  width="100%"
                  isLoading={working}
                  icon={<Icon icon={ScissorsGlyph} />}
                />
                <HStack justify="between" align="center">
                  <Text type="supporting" color="secondary">
                    Shortcut
                  </Text>
                  <Kbd keys="mod+enter" />
                </HStack>
              </VStack>
            </VStack>
          </Card>
          </VStack>
        </HStack>
      </VStack>
    </form>
  );
}
