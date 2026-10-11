export type Provider = "local" | "groq";
export type Layout = "fill" | "fit_blur";
export type Platform = "youtube" | "instagram";
export type VideoEncoder = "auto" | "h264_nvenc" | "libx264" | "h264_qsv";

export type ClipSeo = {
  youtube: { title: string; description: string; tags: string[] };
  instagram: { caption: string };
  hashtags: string[];
  keywords: string[];
  generated_by?: string;
};

export type PublishResult = {
  status: "published" | "error";
  url?: string | null;
  id?: string;
  error?: string;
};

export const PIPELINE_STAGES = [
  { id: "ingest", label: "Pull source" },
  { id: "transcribe", label: "Transcribe" },
  { id: "candidates", label: "Find windows" },
  { id: "score", label: "Rank hooks" },
  { id: "cut", label: "Cut" },
  { id: "reframe", label: "Reframe 9:16" },
  { id: "captions", label: "Burn captions" },
  { id: "export", label: "Export" },
] as const;

export type StageId = (typeof PIPELINE_STAGES)[number]["id"];

export type JobStatus = "queued" | "running" | "done" | "error";

export type ProgressInfo = {
  stage: StageId | "done" | "error";
  percent: number;
  message?: string;
  updatedAt?: number;
};

export type Clip = {
  id: string;
  title: string;
  hook: string;
  reason: string;
  score: number;
  start: number;
  end: number;
  text: string;
  kept: boolean;
  file?: string;
  videoUrl?: string;
  captionStyle?: string | null;
  encoder?: string;
  seo?: ClipSeo;
  publish?: Partial<Record<Platform, PublishResult>>;
};

export type Job = {
  id: string;
  source: string;
  sourceKind: "url" | "file";
  clipCount: number;
  provider: Provider;
  vertical: boolean;
  captions: boolean;
  captionStyle: string;
  layout: Layout;
  videoEncoder?: VideoEncoder;
  createdAt: number;
  startedAt: number;
  status: JobStatus;
  error?: string;
  clips: Clip[];
  progressInfo?: ProgressInfo;
};

export type JobView = Job & {
  stageIndex: number;
  stageId: StageId | "done";
  progress: number;
  progressMessage?: string;
};

export type CreateJobInput = {
  sourceUrl?: string;
  fileName?: string;
  clipCount: number;
  provider: Provider;
  vertical: boolean;
  captions: boolean;
  captionStyle?: string;
  layout?: Layout;
  videoEncoder?: VideoEncoder;
};
