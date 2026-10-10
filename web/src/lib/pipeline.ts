import { PIPELINE_STAGES, type Clip, type Job, type JobView } from "./types";

/** Target progression duration (ms) for each stage in UI preview. */
const STAGE_MS = [1500, 3000, 2000, 3500, 2000, 3000, 2500, 1500];

const TITLE_BANK = [
  "Nobody says this out loud",
  "The part that actually lands",
  "Wait, replay that beat",
  "This is the whole argument",
  "The quiet confession",
  "Three seconds of heat",
  "The question that sticks",
  "Hard cut, real payoff",
];

const HOOK_BANK = [
  "Stop scrolling if you have ever sat through a two-hour episode for one minute of truth.",
  "The first line is a question. The rest is the answer you came for.",
  "They thought this was a throwaway. It is the clip.",
  "Listen to the breath before they say it.",
];

const REASON_BANK = [
  "Opens on a hook, holds one idea, and pays off before the energy drops.",
  "Self-contained beat with a clear punchline and no leftover context.",
  "High speech energy and a clean sentence boundary on both sides.",
  "Surprise in the first seconds, then a concrete takeaway.",
];

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function buildPreviewClips(source: string, count: number): Clip[] {
  const seed = hashString(source || "clipper");
  const clips: Clip[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = 42 + i * 97 + (seed % 17);
    const duration = 24 + ((seed + i * 13) % 28);
    clips.push({
      id: `clip-${i + 1}`,
      title: TITLE_BANK[(seed + i) % TITLE_BANK.length],
      hook: HOOK_BANK[(seed + i * 3) % HOOK_BANK.length],
      reason: REASON_BANK[(seed + i * 5) % REASON_BANK.length],
      score: 92 - i * 7 - ((seed + i) % 5),
      start,
      end: start + duration,
      text: "Candidate segment identified based on speech rate, energy peaks, and hook patterns.",
      kept: true,
    });
  }
  return clips;
}

export function hydrateJob(job: Job, now = Date.now()): JobView {
  if (job.status === "error") {
    return {
      ...job,
      stageIndex: 0,
      stageId: PIPELINE_STAGES[0].id,
      progress: 0,
    };
  }

  // If clips are already populated, the job is definitively complete
  if (job.status === "done" || job.clips.length > 0) {
    return {
      ...job,
      status: "done",
      clips: job.clips.length ? job.clips : buildPreviewClips(job.source, job.clipCount),
      stageIndex: PIPELINE_STAGES.length,
      stageId: "done",
      progress: 1,
    };
  }

  const elapsed = Math.max(0, now - job.startedAt);
  let acc = 0;
  let stageIndex = PIPELINE_STAGES.length - 1;

  for (let i = 0; i < STAGE_MS.length; i += 1) {
    acc += STAGE_MS[i];
    if (elapsed < acc) {
      stageIndex = i;
      break;
    }
  }

  const total = STAGE_MS.reduce((a, b) => a + b, 0);
  const done = elapsed >= total;

  if (done) {
    // If backend took longer than preview total, hold at final export stage (96%) instead of premature completion
    return {
      ...job,
      status: "running",
      stageIndex: PIPELINE_STAGES.length - 1,
      stageId: PIPELINE_STAGES[PIPELINE_STAGES.length - 1].id,
      progress: 0.96,
    };
  }

  const prior = STAGE_MS.slice(0, stageIndex).reduce((a, b) => a + b, 0);
  const local = (elapsed - prior) / STAGE_MS[stageIndex];
  const progress = Math.min(0.95, (stageIndex + local) / PIPELINE_STAGES.length);

  return {
    ...job,
    status: "running",
    stageIndex,
    stageId: PIPELINE_STAGES[stageIndex].id,
    progress,
  };
}

export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, isNaN(seconds) ? 0 : seconds);
  const s = Math.floor(safe);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
