export type Provider = "local" | "groq";

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
};

export type Job = {
  id: string;
  source: string;
  sourceKind: "url" | "file";
  clipCount: number;
  provider: Provider;
  vertical: boolean;
  captions: boolean;
  createdAt: number;
  startedAt: number;
  status: JobStatus;
  error?: string;
  clips: Clip[];
};

export type JobView = Job & {
  stageIndex: number;
  stageId: StageId | "done";
  progress: number;
};

export type CreateJobInput = {
  sourceUrl?: string;
  fileName?: string;
  clipCount: number;
  provider: Provider;
  vertical: boolean;
  captions: boolean;
};
