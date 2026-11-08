"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
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
const MAX_SOUNDTRACK_BYTES = 100 * 1024 * 1024;
const ON_VOLT = "text-white";
const HARD_SHADOW = "shadow-lg shadow-black/40";
const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500";
const FOCUS_WITHIN_RING =
  "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-indigo-500";

const SECTIONS = [
  { id: "source", label: "Source" },
  { id: "format", label: "Format" },
  { id: "captions", label: "Captions" },
  { id: "audio", label: "Audio" },
  { id: "processing", label: "Processing" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const LAYOUTS: { value: Layout; label: string; note: string }[] = [
  { value: "fill", label: "Fill screen", note: "Crops to 9:16 and follows the active speaker" },
  { value: "fit_blur", label: "Fit with blur", note: "Whole frame over a blurred backdrop, good for slides and gameplay" },
  { value: "split_screen", label: "Split screen", note: "Two speakers stacked, each with their own face framing" },
];

const SOCIAL_TEMPLATES: { value: SocialTemplate; label: string; note: string }[] = [
  { value: "none", label: "Clean 9:16", note: "No social card. Full vertical video." },
  { value: "x", label: "Twitter / X", note: "Post header, video, and engagement row." },
  { value: "instagram", label: "Instagram", note: "Reel header, actions, caption, and hashtags." },
  { value: "headline", label: "Viral headline", note: "Editorial headline, quote, and topic badges." },
];

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: "local", label: "Local" },
  { value: "groq", label: "Groq" },
  { value: "openrouter", label: "OpenRouter" },
];

const ENCODERS: { value: VideoEncoder; label: string; note: string }[] = [
  { value: "auto", label: "Auto", note: "NVENC GPU preferred, CPU fallback" },
  { value: "h264_nvenc", label: "NVIDIA NVENC", note: "GPU render on RTX and GTX cards" },
  { value: "libx264", label: "CPU (libx264)", note: "Standard software encoder" },
  { value: "h264_qsv", label: "Intel QSV", note: "Intel Quick Sync GPU" },
];

const VOLUMES: { value: number; label: string; note: string }[] = [
  { value: 0.12, label: "Subtle", note: "12%" },
  { value: 0.18, label: "Balanced", note: "18%" },
  { value: 0.25, label: "Noticeable", note: "25%" },
  { value: 0.32, label: "Loud", note: "32%" },
];

const CATEGORY_FILTERS: { value: "all" | CaptionCategory; label: string }[] = [
  { value: "all", label: "All" },
  { value: "bold", label: "Bold and punchy" },
  { value: "minimal", label: "Clean and minimal" },
  { value: "creative", label: "Creative" },
];

const PRESETS: { id: string; label: string; note: string; patch: Partial<Settings> }[] = [
  {
    id: "talking-head",
    label: "Talking head",
    note: "Face-tracked crop, tight pacing",
    patch: { vertical: true, layout: "fill", trimSilence: true, hookOverlay: true },
  },
  {
    id: "two-speakers",
    label: "Two speakers",
    note: "Split view, tight pacing",
    patch: { vertical: true, layout: "split_screen", trimSilence: true, hookOverlay: true },
  },
  {
    id: "screen",
    label: "Gameplay or slides",
    note: "Full frame on a blurred backdrop",
    patch: { vertical: true, layout: "fit_blur", trimSilence: false, hookOverlay: false },
  },
  {
    id: "widescreen",
    label: "Keep widescreen",
    note: "No reframing",
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
/* Icons                                                               */
/* ------------------------------------------------------------------ */

function Icon({ path, className = "h-4 w-4" }: { path: string; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={path} />
    </svg>
  );
}

const ICON = {
  close: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  check: "M5 12.5l4.5 4.5L19 7.5",
  upload: "M12 16V4m0 0L7 9m5-5l5 5M5 20h14",
  paste: "M9 4h6v3H9zM7 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1",
  chevron: "M6 9l6 6 6-6",
  reset: "M4 12a8 8 0 1 0 3-6.2M4 4v5h5",
};

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

function Section({
  id,
  title,
  hint,
  children,
}: {
  id: SectionId;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-20 rounded-2xl border-2 border-white/15 bg-panel p-4 md:p-6"
    >
      <h3 id={`${id}-title`} className="display text-2xl text-ink md:text-3xl">
        {title}
      </h3>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
      <div className="mt-5 flex flex-col gap-5">{children}</div>
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  title,
  note,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  note: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-start gap-3 rounded-xl border-2 p-3 text-left transition motion-reduce:transition-none ${FOCUS_RING} ${
        checked ? "border-volt/70 bg-volt/10" : "border-white/15 bg-panel-inset hover:border-white/35"
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full border-2 p-0.5 transition-colors motion-reduce:transition-none ${
          checked ? "border-volt bg-volt" : "border-white/30 bg-panel"
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full transition-transform motion-reduce:transition-none ${
            checked ? `translate-x-5 bg-[#101016]` : "translate-x-0 bg-white/60"
          }`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted">{note}</span>
      </span>
    </button>
  );
}

type SegmentOption<T extends string | number> = {
  value: T;
  label: string;
  note?: string;
  glyph?: ReactNode;
};

function Segmented<T extends string | number>({
  name,
  legend,
  value,
  onChange,
  options,
  columns,
}: {
  name: string;
  legend: string;
  value: T;
  onChange: (next: T) => void;
  options: SegmentOption<T>[];
  columns: string;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-semibold text-ink">{legend}</legend>
      <div className={`grid gap-2 ${columns}`}>
        {options.map((option) => {
          const on = option.value === value;
          return (
            <label
              key={String(option.value)}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition motion-reduce:transition-none ${FOCUS_WITHIN_RING} ${
                on
                  ? `border-volt bg-volt ${ON_VOLT} ${HARD_SHADOW}`
                  : "border-white/15 bg-panel-inset text-ink hover:border-white/40"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={String(option.value)}
                checked={on}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.glyph}
              <span className="min-w-0">
                <span className="block text-sm font-bold">{option.label}</span>
                {option.note ? (
                  <span className={`mt-0.5 block text-xs leading-relaxed ${on ? "opacity-80" : "text-muted"}`}>
                    {option.note}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function LayoutGlyph({ kind }: { kind: string }) {
  return (
    <span
      aria-hidden
      className="relative flex h-14 w-8 shrink-0 flex-col gap-0.5 overflow-hidden rounded-md border-2 border-current p-0.5"
    >
      {kind === "split_screen" ? (
        <>
          <span className="relative flex-1 rounded-sm bg-current opacity-30" />
          <span className="relative flex-1 rounded-sm bg-current opacity-30" />
        </>
      ) : (
        <span className="relative flex-1 rounded-sm bg-current opacity-30" />
      )}
      {kind === "fill" ? (
        <span className="absolute left-1/2 top-3 h-3 w-3 -translate-x-1/2 rounded-full bg-current" />
      ) : null}
      {kind === "fit_blur" ? (
        <span className="absolute inset-x-0.5 top-1/2 h-4 -translate-y-1/2 rounded-sm bg-current" />
      ) : null}
      {kind === "split_screen" ? (
        <>
          <span className="absolute left-1/2 top-2 h-2 w-2 -translate-x-1/2 rounded-full bg-current" />
          <span className="absolute bottom-2 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-current" />
        </>
      ) : null}
    </span>
  );
}

function CaptionSample({ option, pad }: { option: CaptionOption; pad: string }) {
  const single = option.key === "one_word";
  const words = single ? ["THIS"] : ["MAKE", "IT", "COUNT"];
  const activeIndex = single ? 0 : 1;
  return (
    <>
      {words.map((word, index) => {
        const active = index === activeIndex;
        return (
          <span
            key={word}
            style={{
              font: option.font,
              color: active ? option.active : option.base,
              background: active ? option.activeBg : undefined,
              padding: active && option.activeBg ? pad : undefined,
              borderRadius: 4,
              WebkitTextStroke: `0.7px ${option.stroke}`,
              textShadow: option.glow ? `0 0 8px ${option.glow}` : undefined,
            }}
          >
            {option.upper ? word : word.toLowerCase()}
          </span>
        );
      })}
    </>
  );
}

function Face({ className = "h-5 w-5" }: { className?: string }) {
  return <span className={`block rounded-full bg-white/40 ${className}`} />;
}

function FramePreview({ settings, option, layoutLabel }: { settings: Settings; option: CaptionOption; layoutLabel: string }) {
  const { vertical, layout, captions, hookOverlay, progressBar, template } = settings;
  const frame = vertical ? "aspect-[9/16] w-36" : "aspect-video w-full max-w-64";

  if (vertical && template !== "none") {
    const profile = settings.templateDisplayName || "Your Name";
    const initials = profile.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
    const sampleCaption = (
      <span className="rounded bg-black/80 px-1 py-0.5 text-[7px] font-bold text-white">
        <CaptionSample option={option} pad="1px 3px" />
      </span>
    );
    return (
      <div
        role="img"
        aria-label={"Live preview: " + template + " social media video template"}
        className="relative mx-auto flex aspect-[9/16] w-36 flex-col overflow-hidden rounded-2xl border-2 border-white/25 text-white"
      >
        {template === "x" ? (
          <>
            <div className="h-[26%] shrink-0 bg-black px-2 pt-2">
              <div className="flex items-center gap-1.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500 text-[8px] font-extrabold">{initials}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[8px] font-bold">{profile}</span>
                  <span className="block truncate text-[6px] text-slate-400">{settings.templateHandle} · 2h</span>
                </span>
                <span className="font-display text-sm font-bold">X</span>
              </div>
              <p className="mt-2 line-clamp-3 text-[8px] leading-snug text-white">Your clip hook appears here.</p>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-[#080d12]">
              <div className="relative flex h-full aspect-[9/16] max-w-full items-center justify-center border-x border-white/10 bg-white/10">
                <span className="text-[8px] font-bold tracking-widest text-white/70">VIDEO</span>
                {captions ? <span className="absolute bottom-[20%]">{sampleCaption}</span> : null}
                {hookOverlay ? <span className="absolute top-2 rounded bg-white/80 px-1 py-0.5 text-[6px] font-bold text-black">HOOK</span> : null}
                {progressBar ? <span className="absolute bottom-0 left-0 h-0.5 w-2/5 bg-volt" /> : null}
              </div>
            </div>
            <div className="h-[17%] shrink-0 border-t border-white/15 bg-black px-2 py-2">
              <div className="flex justify-between text-[6px] text-slate-300"><span>↻ —</span><span>♡ —</span><span>▣ —</span><span>◉ —</span></div>
              <p className="mt-2 text-center text-[6px] text-slate-500">REPOSTS · LIKES · SAVES · VIEWS</p>
            </div>
          </>
        ) : null}

        {template === "instagram" ? (
          <>
            <div className="h-[17%] shrink-0 bg-[#101012] px-2 pt-2">
              <div className="flex items-center gap-1.5">
                <span className="rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 p-[2px]">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#304b66] text-[7px] font-bold">{initials}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[8px] font-bold">{profile}</span>
                  <span className="block truncate text-[6px] text-slate-400">{settings.templateHandle} · Original audio</span>
                </span>
                <span className="text-[9px]">•••</span>
              </div>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-[#08090b]">
              <div className="relative flex h-full aspect-[9/16] max-w-full items-center justify-center bg-white/10">
                <span className="text-[8px] font-bold tracking-widest text-white/70">REEL</span>
                {captions ? <span className="absolute bottom-[20%]">{sampleCaption}</span> : null}
                {hookOverlay ? <span className="absolute top-2 rounded bg-white/80 px-1 py-0.5 text-[6px] font-bold text-black">HOOK</span> : null}
                {progressBar ? <span className="absolute bottom-0 left-0 h-0.5 w-2/5 bg-volt" /> : null}
              </div>
            </div>
            <div className="h-[21%] shrink-0 bg-[#101012] px-2 py-1.5">
              <div className="flex items-center justify-between text-[9px]"><span>♡　○　➤</span><span>▯</span></div>
              <p className="mt-1 line-clamp-2 text-[6px] leading-tight"><b>{profile}</b> Your caption appears here.</p>
              <p className="mt-1 truncate text-[6px] text-sky-300">#Reels #CreatorTips #Shorts</p>
            </div>
          </>
        ) : null}

        {template === "headline" ? (
          <>
            <div className="h-[24%] shrink-0 bg-[#090b0e] p-2">
              <div className="h-full rounded-md bg-[#f4d35e] p-2 text-black">
                <span className="block text-[6px] font-extrabold tracking-widest">THE MOMENT THAT MATTERS</span>
                <span className="mt-1 block font-display text-[13px] font-black uppercase leading-[0.95]">THE IDEA THAT CHANGES EVERYTHING</span>
              </div>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-[#050607]">
              <div className="relative flex h-full aspect-[9/16] max-w-full items-center justify-center bg-white/10">
                <span className="text-[8px] font-bold tracking-widest text-white/70">VIDEO</span>
                {captions ? <span className="absolute bottom-[20%]">{sampleCaption}</span> : null}
                {progressBar ? <span className="absolute bottom-0 left-0 h-0.5 w-2/5 bg-volt" /> : null}
              </div>
            </div>
            <div className="h-[15%] shrink-0 border-t border-white/15 bg-[#090b0e] px-2 py-2">
              <p className="line-clamp-2 text-[7px] font-semibold leading-tight">“Your strongest clip quote appears here.”</p>
              <div className="mt-1 flex gap-1">
                <span className="rounded-full border border-white/30 px-1 py-0.5 text-[5px] text-yellow-200">TOPIC</span>
                <span className="rounded-full border border-white/30 px-1 py-0.5 text-[5px] text-yellow-200">QUOTE</span>
              </div>
            </div>
          </>
        ) : null}
      </div>
    );
  }

  let art: ReactNode;
  if (!vertical) {
    art = (
      <div className="absolute inset-0 flex items-center justify-center bg-white/10">
        <Face />
      </div>
    );
  } else if (layout === "fit_blur") {
    art = (
      <div className="absolute inset-0 flex items-center bg-white/10">
        <div className="flex aspect-video w-full items-center justify-center bg-white/20">
          <Face className="h-4 w-4" />
        </div>
      </div>
    );
  } else if (layout === "split_screen") {
    art = (
      <div className="absolute inset-0 flex flex-col gap-0.5">
        <div className="flex flex-1 items-center justify-center bg-white/15">
          <Face className="h-4 w-4" />
        </div>
        <div className="flex flex-1 items-center justify-center bg-white/10">
          <Face className="h-4 w-4" />
        </div>
      </div>
    );
  } else {
    art = (
      <div className="absolute inset-0 flex items-start justify-center bg-white/10 pt-[28%]">
        <Face className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={`Preview: ${vertical ? layoutLabel : "widescreen"}, ${captions ? `${option.label} captions` : "no captions"}`}
      className={`relative mx-auto overflow-hidden rounded-2xl border-2 border-white/25 bg-[#07090e] ${frame}`}
    >
      {art}
      {hookOverlay ? <span className="absolute inset-x-3 top-3 h-3 rounded bg-white/70" /> : null}
      {captions ? (
        <div
          className={`absolute inset-x-1 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 overflow-hidden ${
            vertical ? "bottom-[20%]" : "bottom-[12%]"
          }`}
        >
          <CaptionSample option={option} pad="1px 4px" />
        </div>
      ) : null}
      {progressBar ? <span className="absolute bottom-0 left-0 h-1 w-2/5 bg-volt" /> : null}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  warn,
  onClick,
}: {
  label: string;
  value: string;
  warn?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-baseline justify-between gap-4 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/5 motion-reduce:transition-none ${FOCUS_RING}`}
      >
        <span className="shrink-0 text-sm text-muted">{label}</span>
        <span className={`min-w-0 truncate text-sm font-semibold ${warn ? "text-punch" : "text-ink"}`}>{value}</span>
      </button>
    </li>
  );
}

function IndeterminateBar() {
  return (
    <span aria-hidden className="block h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <span className="block h-full w-1/3 animate-pulse rounded-full bg-volt motion-reduce:animate-none" />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function CutForm() {
  const router = useRouter();

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
        if (next.templateHandle && !next.templateHandle.startsWith("@")) next.templateHandle = "@" + next.templateHandle.replace(/^@+/, "");
        next.clipCount = clamp(Number(next.clipCount) || DEFAULTS.clipCount, 1, 10);
        queueMicrotask(() => {
          setSettings(next);
        });
      }
    } catch {
      /* storage unavailable or corrupt, defaults stay */
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
  const [uploadedName, setUploadedName] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [draggingSource, setDraggingSource] = useState(false);

  const [soundtrackPath, setSoundtrackPath] = useState("");
  const [soundtrackName, setSoundtrackName] = useState("");
  const [uploadingSoundtrack, setUploadingSoundtrack] = useState(false);
  const [draggingSoundtrack, setDraggingSoundtrack] = useState(false);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [processingOpen, setProcessingOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>("source");

  const sourceRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const patch = (next: Partial<Settings>) => setSettings((prev) => ({ ...prev, ...next }));

  const selectedOption = CAPTION_STYLE_OPTIONS.find((o) => o.key === settings.captionStyle) || CAPTION_STYLE_OPTIONS[0];
  const layoutLabel = LAYOUTS.find((l) => l.value === settings.layout)?.label ?? "Fill screen";
  const providerLabel = PROVIDERS.find((p) => p.value === settings.provider)?.label ?? settings.provider;
  const encoderLabel = ENCODERS.find((e) => e.value === settings.videoEncoder)?.label ?? settings.videoEncoder;
  const volumeLabel = VOLUMES.find((v) => v.value === settings.soundtrackVolume);
  const sourceKind = describeSource(sourceUrl, uploadedName);
  const working = busy || uploading || uploadingSoundtrack;
  const visibleOptions = CAPTION_STYLE_OPTIONS.filter(
    (o) => settings.captionCategory === "all" || o.category === settings.captionCategory,
  );
  const enabledExtras = [
    settings.hookOverlay && "Hook",
    settings.loudnorm && "Loudness",
    settings.trimSilence && "Trim",
    settings.progressBar && "Progress bar",
  ].filter(Boolean) as string[];



  useEffect(() => {
    if (!hydrated || !hasLoadedStorageRef.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* storage full or blocked, safe to skip */
    }
  }, [settings, hydrated]);

  /* Highlight the section tab that is in view */
  useEffect(() => {
    const targets = SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
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

  /* Bring API errors into view */
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [error]);

  function goTo(id: SectionId) {
    if (id === "processing") setProcessingOpen(true);
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    });
  }

  function presetActive(preset: (typeof PRESETS)[number]) {
    return (Object.keys(preset.patch) as (keyof Settings)[]).every((key) => settings[key] === preset.patch[key]);
  }

  function resetSettings() {
    setSettings(DEFAULTS);
  }

  /* Source handling */
  function changeSource(value: string) {
    setSourceUrl(value);
    setSourceError("");
    if (uploadedName) {
      setUploadedName("");
      setUploadStatus("");
    }
  }

  async function pasteSource() {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) changeSource(text.trim());
    } catch {
      /* clipboard permission denied, user can paste manually */
    }
    sourceRef.current?.focus();
  }

  async function uploadSource(file: File) {
    if (!isVideoFile(file)) {
      setSourceError("That file is not a video. Use MP4, MOV, MKV or WebM.");
      return;
    }
    setError("");
    setSourceError("");
    setUploading(true);
    setUploadStatus(`Uploading ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`);
    try {
      const result = await uploadVideo(file);
      setSourceUrl(result.path);
      setUploadedName(file.name);
      setUploadStatus("");
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : "Upload failed. Try again.");
      setUploadStatus("");
    } finally {
      setUploading(false);
    }
  }

  function onSourceFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void uploadSource(file);
  }

  function onSourceDrop(e: DragEvent) {
    e.preventDefault();
    setDraggingSource(false);
    const file = e.dataTransfer.files?.[0];
    if (file && !uploading && !busy) void uploadSource(file);
  }

  /* Soundtrack handling */
  async function uploadMusic(file: File) {
    if (!isAudioFile(file)) {
      setError("That file is not audio. Use MP3, WAV, M4A, AAC, OGG or FLAC.");
      return;
    }
    if (file.size > MAX_SOUNDTRACK_BYTES) {
      setError("That audio file is over 100 MB. Pick a smaller one.");
      return;
    }
    setError("");
    setUploadingSoundtrack(true);
    try {
      const uploaded = await uploadSoundtrack(file);
      setSoundtrackPath(uploaded.path);
      setSoundtrackName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Soundtrack upload failed. Try again.");
    } finally {
      setUploadingSoundtrack(false);
    }
  }

  function onSoundtrackFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void uploadMusic(file);
  }

  function onSoundtrackDrop(e: DragEvent) {
    e.preventDefault();
    setDraggingSoundtrack(false);
    const file = e.dataTransfer.files?.[0];
    if (file && !uploadingSoundtrack && !busy) void uploadMusic(file);
  }

  /* Submit */
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");

    const trimmed = sourceUrl.trim();
    if (!trimmed) {
      setSourceError("Add a video link, upload a file, or enter a file path.");
      goTo("source");
      sourceRef.current?.focus();
      return;
    }
    if (describeSource(trimmed, uploadedName) === "Invalid link") {
      setSourceError("That link will not open. Start it with https:// and check the address.");
      goTo("source");
      sourceRef.current?.focus();
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
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the cut. Try again.");
      setBusy(false);
    }
  }

  function onFormKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !working) {
      e.preventDefault();
      e.currentTarget.requestSubmit();
    }
  }

  const ctaLabel = uploading
    ? "Uploading video"
    : busy
      ? "Starting cut"
      : `Cut ${settings.clipCount} ${settings.clipCount === 1 ? "clip" : "clips"}`;

  const submitButton = (
    <button
      type="submit"
      disabled={working}
      className={`display flex w-full items-center justify-center gap-2 rounded-xl border-2 border-volt bg-volt px-4 py-3 text-2xl ${ON_VOLT} ${HARD_SHADOW} transition hover:bg-[#a5b4fc] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none ${FOCUS_RING}`}
    >
      {busy ? (
        <span
          aria-hidden
          className="h-5 w-5 animate-spin rounded-full border-[3px] border-[#101016]/30 border-t-[#101016] motion-reduce:animate-none"
        />
      ) : null}
      {ctaLabel}
    </button>
  );

  /* ---------------------------------------------------------------- */

  return (
    <form
      onSubmit={onSubmit}
      onKeyDown={onFormKeyDown}
      noValidate
      className="grid gap-6 pb-32 lg:grid-cols-[minmax(0,1fr)_21rem] lg:pb-0"
    >
      <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <legend className="sr-only">Cut settings</legend>

        <div className="flex items-center justify-between gap-3">
          <h2 className="display text-4xl text-ink md:text-5xl">New cut</h2>
          <button
            type="button"
            onClick={resetSettings}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-muted transition hover:bg-white/5 hover:text-ink motion-reduce:transition-none ${FOCUS_RING}`}
          >
            <Icon path={ICON.reset} />
            Reset settings
          </button>
        </div>

        <nav
          aria-label="Jump to section"
          className="sticky top-0 z-20 -mx-1 flex gap-1.5 overflow-x-auto bg-panel-raised px-1 py-2"
        >
          {SECTIONS.map((section) => {
            const on = activeSection === section.id;
            const done = section.id === "source" && !!sourceUrl.trim();
            return (
              <button
                key={section.id}
                type="button"
                aria-current={on ? "true" : undefined}
                onClick={() => goTo(section.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border-2 px-3.5 py-1.5 text-sm font-semibold transition motion-reduce:transition-none ${FOCUS_RING} ${
                  on ? `border-volt bg-volt ${ON_VOLT}` : "border-white/15 text-muted hover:border-white/40 hover:text-ink"
                }`}
              >
                {done ? <Icon path={ICON.check} className="h-3.5 w-3.5" /> : null}
                {section.label}
              </button>
            );
          })}
        </nav>

        {/* Source */}
        <Section id="source" title="Source" hint="Paste a link, drop a video, or type a file path.">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDraggingSource(true);
            }}
            onDragLeave={() => setDraggingSource(false)}
            onDrop={onSourceDrop}
            className={`rounded-xl border-2 border-dashed p-3 transition motion-reduce:transition-none md:p-4 ${
              draggingSource ? "border-volt bg-volt/10" : "border-white/20 bg-panel-inset"
            }`}
          >
            <div className="flex gap-2">
              <input
                ref={sourceRef}
                type="text"
                name="sourceUrl"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                aria-label="Video link or file path"
                aria-invalid={!!sourceError}
                aria-describedby="source-help"
                placeholder="Paste a YouTube link or file path"
                value={sourceUrl}
                onChange={(e) => changeSource(e.target.value)}
                className={`min-w-0 flex-1 rounded-lg border-2 bg-panel px-3.5 py-3 font-mono text-base text-ink placeholder:text-muted/60 focus:border-ice focus:outline-none ${
                  sourceError ? "border-punch" : "border-white/15"
                }`}
              />
              {sourceUrl ? (
                <button
                  type="button"
                  onClick={() => {
                    changeSource("");
                    sourceRef.current?.focus();
                  }}
                  aria-label="Clear source"
                  className={`flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center rounded-lg border-2 border-white/15 text-muted transition hover:border-white/40 hover:text-ink motion-reduce:transition-none ${FOCUS_RING}`}
                >
                  <Icon path={ICON.close} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={pasteSource}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg border-2 border-white/15 px-3.5 text-sm font-semibold text-ink transition hover:border-volt hover:text-volt motion-reduce:transition-none ${FOCUS_RING}`}
                >
                  <Icon path={ICON.paste} />
                  Paste
                </button>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-lg border-2 border-white/20 bg-panel-raised px-3.5 py-2 text-sm font-semibold text-ink transition hover:border-volt hover:text-volt motion-reduce:transition-none ${FOCUS_WITHIN_RING} ${
                  uploading || busy ? "pointer-events-none opacity-60" : ""
                }`}
              >
                <Icon path={ICON.upload} />
                Browse files
                <input type="file" accept="video/*,.mkv" disabled={uploading || busy} className="sr-only" onChange={onSourceFile} />
              </label>
              <span id="source-help" className="text-sm text-muted">
                or drop a video here. MP4, MOV, MKV or WebM.
              </span>
            </div>
          </div>

          <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
            {uploading ? (
              <>
                <p className="text-sm text-ink">{uploadStatus}</p>
                <IndeterminateBar />
              </>
            ) : null}
            {!uploading && sourceKind && sourceKind !== "Invalid link" ? (
              <p className="flex min-w-0 items-center gap-2 text-sm text-muted">
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-volt/15 px-2.5 py-0.5 font-semibold text-volt">
                  <Icon path={ICON.check} className="h-3 w-3" />
                  {sourceKind}
                </span>
                {uploadedName ? <span className="min-w-0 truncate">{uploadedName}</span> : null}
              </p>
            ) : null}
            {sourceError ? (
              <p role="alert" className="text-sm font-semibold text-punch">
                {sourceError}
              </p>
            ) : null}
          </div>
        </Section>

        {/* Format */}
        <Section id="format" title="Format" hint="Pick a starting point, then adjust anything below.">
          <div role="group" aria-label="Presets" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {PRESETS.map((preset) => {
              const on = presetActive(preset);
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => patch(preset.patch)}
                  className={`rounded-xl border-2 p-3 text-left transition motion-reduce:transition-none ${FOCUS_RING} ${
                    on
                      ? `border-volt bg-volt ${ON_VOLT} ${HARD_SHADOW}`
                      : "border-white/15 bg-panel-inset text-ink hover:border-white/40"
                  }`}
                >
                  <span className="block text-sm font-bold">{preset.label}</span>
                  <span className={`mt-0.5 block text-xs leading-relaxed ${on ? "opacity-80" : "text-muted"}`}>
                    {preset.note}
                  </span>
                </button>
              );
            })}
          </div>

          <Toggle
            checked={settings.vertical}
            onChange={(vertical) => patch({ vertical, ...(vertical ? {} : { template: "none" }) })}
            title="Vertical 9:16"
            note={
              settings.vertical
                ? "Reframes each clip to full screen and tracks the speaker's face."
                : "Off. Clips keep the original widescreen frame."
            }
          />

          {settings.vertical ? (
            <>
              <Segmented
                name="layout"
                legend="Framing"
                value={settings.layout}
                onChange={(layout) => patch({ layout })}
                columns="md:grid-cols-3"
                options={LAYOUTS.map((l) => ({ value: l.value, label: l.label, note: l.note, glyph: <LayoutGlyph kind={l.value} /> }))}
              />
              <Segmented
                name="socialTemplate"
                legend="Social media template"
                value={settings.template}
                onChange={(template) => patch({ template })}
                columns="md:grid-cols-2"
                options={SOCIAL_TEMPLATES.map((item) => ({
                  value: item.value,
                  label: item.label,
                  note: item.note,
                }))}
              />
              {settings.template === "x" || settings.template === "instagram" ? (
                <div className="grid gap-3 rounded-xl border-2 border-white/15 bg-panel-inset p-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-muted">
                    Display name
                    <input
                      value={settings.templateDisplayName}
                      maxLength={40}
                      onChange={(event) => patch({ templateDisplayName: event.target.value.slice(0, 40) })}
                      className="min-h-10 rounded-lg border border-white/15 bg-panel px-3 text-sm font-medium normal-case tracking-normal text-ink focus:border-ice focus:outline-none"
                      placeholder="Your Name"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-muted">
                    Handle
                    <input
                      value={settings.templateHandle}
                      maxLength={32}
                      onChange={(event) => patch({ templateHandle: event.target.value.replace(/\s+/g, "").slice(0, 32) })}
                      onBlur={() => {
                        const handle = settings.templateHandle.trim();
                        if (handle && !handle.startsWith("@")) {
                          patch({ templateHandle: "@" + handle.replace(/^@+/, "") });
                        }
                      }}
                      className="min-h-10 rounded-lg border border-white/15 bg-panel px-3 text-sm font-medium normal-case tracking-normal text-ink focus:border-ice focus:outline-none"
                      placeholder="@yourhandle"
                    />
                  </label>
                </div>
              ) : null}
            </>
          ) : null}

          <div className="flex flex-col gap-2">
            <label htmlFor="clip-count" className="text-sm font-semibold text-ink">
              Number of clips
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Fewer clips"
                disabled={settings.clipCount <= 1}
                onClick={() => patch({ clipCount: clamp(settings.clipCount - 1, 1, 10) })}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 border-white/20 text-ink transition hover:border-volt hover:text-volt disabled:opacity-40 disabled:hover:border-white/20 disabled:hover:text-ink motion-reduce:transition-none ${FOCUS_RING}`}
              >
                <Icon path={ICON.minus} />
              </button>
              <output htmlFor="clip-count" className="display w-10 text-center text-4xl text-ink">
                {settings.clipCount}
              </output>
              <button
                type="button"
                aria-label="More clips"
                disabled={settings.clipCount >= 10}
                onClick={() => patch({ clipCount: clamp(settings.clipCount + 1, 1, 10) })}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 border-white/20 text-ink transition hover:border-volt hover:text-volt disabled:opacity-40 disabled:hover:border-white/20 disabled:hover:text-ink motion-reduce:transition-none ${FOCUS_RING}`}
              >
                <Icon path={ICON.plus} />
              </button>
              <input
                id="clip-count"
                type="range"
                min={1}
                max={10}
                step={1}
                value={settings.clipCount}
                onChange={(e) => patch({ clipCount: clamp(Number(e.target.value), 1, 10) })}
                className="h-11 min-w-0 flex-1 cursor-pointer accent-volt"
              />
            </div>
          </div>
        </Section>

        {/* Captions */}
        <Section id="captions" title="Captions" hint="The style you pick is burned into every exported clip.">
          <Toggle
            checked={settings.captions}
            onChange={(captions) => patch({ captions })}
            title="Animated captions"
            note={settings.captions ? "Words highlight as they are spoken." : "Off. Clips export without captions."}
          />

          {settings.captions ? (
            <>
              <div role="group" aria-label="Filter caption styles" className="flex flex-wrap gap-2">
                {CATEGORY_FILTERS.map((filter) => {
                  const on = settings.captionCategory === filter.value;
                  return (
                    <button
                      key={filter.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => patch({ captionCategory: filter.value })}
                      className={`rounded-full border-2 px-3.5 py-1.5 text-sm font-semibold transition motion-reduce:transition-none ${FOCUS_RING} ${
                        on ? `border-volt bg-volt ${ON_VOLT}` : "border-white/15 text-muted hover:border-white/40 hover:text-ink"
                      }`}
                    >
                      {filter.label}
                    </button>
                  );
                })}
              </div>

              <fieldset className="min-w-0">
                <legend className="sr-only">Caption style</legend>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4">
                  {visibleOptions.map((opt) => {
                    const on = settings.captionStyle === opt.key;
                    return (
                      <label
                        key={opt.key}
                        className={`relative cursor-pointer rounded-xl border-2 p-2.5 transition motion-reduce:transition-none ${FOCUS_WITHIN_RING} ${
                          on ? `border-volt bg-volt/10 ${HARD_SHADOW}` : "border-white/15 bg-panel-inset hover:border-white/40"
                        }`}
                      >
                        <input
                          type="radio"
                          name="captionStyle"
                          value={opt.key}
                          checked={on}
                          onChange={() => patch({ captionStyle: opt.key })}
                          className="sr-only"
                        />
                        <span
                          className={`flex h-16 items-center justify-center gap-1 overflow-hidden rounded-lg border px-1 ${
                            on ? "border-volt/40 bg-[#07090e]" : "border-white/10 bg-[#09090e]"
                          }`}
                        >
                          <CaptionSample option={opt} pad="0 4px" />
                        </span>
                        <span className="mt-2.5 flex items-center justify-between gap-2">
                          <span className="text-sm font-bold text-ink">{opt.label}</span>
                          {on ? (
                            <span className={`flex h-5 w-5 items-center justify-center rounded-full bg-volt ${ON_VOLT}`}>
                              <Icon path={ICON.check} className="h-3 w-3" />
                              <span className="sr-only">Selected</span>
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted">{opt.description}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </>
          ) : null}
        </Section>

        {/* Audio and retention */}
        <Section id="audio" title="Audio and retention" hint="Small touches that keep people watching.">
          <div className="grid gap-3 md:grid-cols-2">
            <Toggle
              checked={settings.hookOverlay}
              onChange={(hookOverlay) => patch({ hookOverlay })}
              title="Hook headline"
              note="Shows a headline over the first 2.5 seconds, then fades it out."
            />
            <Toggle
              checked={settings.loudnorm}
              onChange={(loudnorm) => patch({ loudnorm })}
              title="Normalize loudness"
              note="Levels audio to -14 LUFS, the standard for YouTube and Instagram."
            />
            <Toggle
              checked={settings.trimSilence}
              onChange={(trimSilence) => patch({ trimSilence })}
              title="Trim silence and fillers"
              note="Cuts pauses over 0.4 seconds and filler words like um and uh. Captions stay in sync."
            />
            <Toggle
              checked={settings.progressBar}
              onChange={(progressBar) => patch({ progressBar })}
              title="Progress bar"
              note="Adds a thin bar along the bottom edge that fills as the clip plays."
            />
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDraggingSoundtrack(true);
            }}
            onDragLeave={() => setDraggingSoundtrack(false)}
            onDrop={onSoundtrackDrop}
            className={`flex flex-col gap-3 rounded-xl border-2 border-dashed p-3 transition motion-reduce:transition-none md:p-4 ${
              draggingSoundtrack ? "border-volt bg-volt/10" : "border-white/20 bg-panel-inset"
            }`}
          >
            <div>
              <p className="text-sm font-semibold text-ink">Background music</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                Optional. Clipper finds a strong section of the track for each clip and lowers it under speech.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-lg border-2 border-white/20 bg-panel-raised px-3.5 py-2 text-sm font-semibold text-ink transition hover:border-volt hover:text-volt motion-reduce:transition-none ${FOCUS_WITHIN_RING} ${
                  uploadingSoundtrack || busy ? "pointer-events-none opacity-60" : ""
                }`}
              >
                <Icon path={ICON.upload} />
                {uploadingSoundtrack ? "Uploading" : soundtrackName ? "Replace track" : "Choose audio"}
                <input
                  type="file"
                  accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/*"
                  disabled={uploadingSoundtrack || busy}
                  className="sr-only"
                  onChange={onSoundtrackFile}
                />
              </label>
              <span className="min-w-0 flex-1 truncate text-sm text-muted" aria-live="polite">
                {soundtrackName || "or drop a file here. MP3, WAV, M4A, AAC, OGG or FLAC, up to 100 MB."}
              </span>
              {soundtrackPath ? (
                <button
                  type="button"
                  onClick={() => {
                    setSoundtrackPath("");
                    setSoundtrackName("");
                  }}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-semibold text-muted transition hover:text-punch motion-reduce:transition-none ${FOCUS_RING}`}
                >
                  <Icon path={ICON.close} className="h-3.5 w-3.5" />
                  Remove
                </button>
              ) : null}
            </div>
            {uploadingSoundtrack ? <IndeterminateBar /> : null}

            {soundtrackPath ? (
              <Segmented
                name="soundtrackVolume"
                legend="Music level"
                value={settings.soundtrackVolume}
                onChange={(soundtrackVolume) => patch({ soundtrackVolume })}
                columns="grid-cols-2 md:grid-cols-4"
                options={VOLUMES.map((v) => ({ value: v.value, label: v.label, note: v.note }))}
              />
            ) : null}
          </div>
        </Section>

        {/* Processing */}
        <section id="processing" aria-labelledby="processing-title" className="scroll-mt-20 rounded-2xl border-2 border-white/15 bg-panel">
          <details open={processingOpen} onToggle={(e) => setProcessingOpen(e.currentTarget.open)} className="group">
            <summary
              className={`flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl p-4 md:p-6 [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}
            >
              <span className="min-w-0">
                <h3 id="processing-title" className="display text-2xl text-ink md:text-3xl">
                  Processing
                </h3>
                <span className="mt-1 block truncate text-sm text-muted">
                  {providerLabel} for analysis, {encoderLabel} for rendering
                </span>
              </span>
              <Icon path={ICON.chevron} className="h-5 w-5 shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            </summary>
            <div className="flex flex-col gap-5 px-4 pb-4 md:px-6 md:pb-6">
              <div className="flex flex-col gap-2">
                <Segmented
                  name="provider"
                  legend="Inference provider"
                  value={settings.provider}
                  onChange={(provider) => patch({ provider })}
                  columns="grid-cols-3"
                  options={PROVIDERS.map((p) => ({ value: p.value, label: p.label }))}
                />
                <p className="text-xs leading-relaxed text-muted">{providerNote(settings.provider)}</p>
              </div>
              <Segmented
                name="videoEncoder"
                legend="Hardware acceleration"
                value={settings.videoEncoder}
                onChange={(videoEncoder) => patch({ videoEncoder })}
                columns="sm:grid-cols-2"
                options={ENCODERS.map((e) => ({ value: e.value, label: e.label, note: e.note }))}
              />
            </div>
          </details>
        </section>
      </fieldset>

      {/* Summary rail */}
      <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
        <div className="rounded-2xl border-2 border-white/15 bg-panel p-4">
          <h3 className="display mb-3 text-xl text-ink">Preview</h3>
          <FramePreview settings={settings} option={selectedOption} layoutLabel={layoutLabel} />
          <p className="mt-3 text-center text-xs text-muted">Framing is a sketch. Captions show your chosen style.</p>
        </div>

        <div className="rounded-2xl border-2 border-white/15 bg-panel p-2">
          <h3 className="display px-2 pb-1 pt-2 text-xl text-ink">Your cut</h3>
          <ul>
            <SummaryRow
              label="Source"
              value={sourceKind ? uploadedName || sourceUrl.trim() : "Not added"}
              warn={!sourceKind || sourceKind === "Invalid link"}
              onClick={() => goTo("source")}
            />
            <SummaryRow label="Clips" value={String(settings.clipCount)} onClick={() => goTo("format")} />
            <SummaryRow label="Format" value={settings.vertical ? `9:16, ${layoutLabel}` : "Widescreen"} onClick={() => goTo("format")} />
            <SummaryRow
              label="Template"
              value={SOCIAL_TEMPLATES.find((item) => item.value === settings.template)?.label ?? "Clean 9:16"}
              onClick={() => goTo("format")}
            />
            <SummaryRow label="Captions" value={settings.captions ? selectedOption.label : "Off"} onClick={() => goTo("captions")} />
            <SummaryRow
              label="Music"
              value={soundtrackName ? `${soundtrackName} at ${volumeLabel?.note ?? `${Math.round(settings.soundtrackVolume * 100)}%`}` : "None"}
              onClick={() => goTo("audio")}
            />
            <SummaryRow label="Extras" value={enabledExtras.length ? enabledExtras.join(", ") : "None"} onClick={() => goTo("audio")} />
            <SummaryRow label="Engine" value={`${providerLabel}, ${encoderLabel}`} onClick={() => goTo("processing")} />
          </ul>
        </div>

        <div className="hidden flex-col gap-2 lg:flex">
          <div ref={errorRef}>
            {error ? (
              <p role="alert" className="rounded-xl border-2 border-punch/70 bg-punch/15 px-3 py-2.5 text-sm font-semibold text-punch">
                {error}
              </p>
            ) : null}
          </div>
          {submitButton}
          <p className="text-center text-xs text-muted">
            <kbd className="rounded border border-white/20 px-1.5 py-0.5 font-sans text-[11px]">Ctrl or Cmd + Enter</kbd> to start
          </p>
        </div>
      </aside>

      {/* Mobile action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex flex-col gap-2 border-t-2 border-white/15 bg-panel p-3 lg:hidden">
        {error ? (
          <p role="alert" className="rounded-lg border-2 border-punch/70 bg-punch/15 px-3 py-2 text-sm font-semibold text-punch">
            {error}
          </p>
        ) : null}
        {submitButton}
      </div>
    </form>
  );
}