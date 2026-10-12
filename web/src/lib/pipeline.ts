import { PIPELINE_STAGES, type Job, type JobView } from "./types";

/**
 * Hydrates a job with real pipeline stage tracking.
 * Strictly relies on actual pipeline output and progress.json — zero simulated timers or fake preview clips.
 */
export function hydrateJob(job: Job): JobView {
  if (job.status === "error") {
    const rawStage =
      job.progressInfo?.stage && job.progressInfo.stage !== "error"
        ? job.progressInfo.stage
        : PIPELINE_STAGES[0].id;
    const stageIndex = PIPELINE_STAGES.findIndex((s) => s.id === rawStage);
    const progress = job.progressInfo?.percent
      ? Math.max(0.04, Math.min(0.99, job.progressInfo.percent / 100))
      : 0.04;

    return {
      ...job,
      stageIndex: stageIndex >= 0 ? stageIndex : 0,
      stageId: (stageIndex >= 0 ? PIPELINE_STAGES[stageIndex].id : PIPELINE_STAGES[0].id) as any,
      progress,
      progressMessage: job.error || job.progressInfo?.message || "An error occurred during processing.",
    };
  }

  if (job.status === "done") {
    return {
      ...job,
      stageIndex: PIPELINE_STAGES.length,
      stageId: "done",
      progress: 1.0,
      progressMessage: job.progressInfo?.message || `${job.clips.length} vertical clips generated.`,
    };
  }

  // Active / running job
  if (job.progressInfo) {
    const stageId = job.progressInfo.stage;
    let stageIndex = PIPELINE_STAGES.findIndex((s) => s.id === stageId);
    if (stageIndex === -1) {
      stageIndex = stageId === "done" ? PIPELINE_STAGES.length : 0;
    }
    const progress = Math.min(0.99, Math.max(0.02, job.progressInfo.percent / 100));

    return {
      ...job,
      stageIndex,
      stageId: stageId === "done" ? "done" : PIPELINE_STAGES[stageIndex]?.id || PIPELINE_STAGES[0].id,
      progress,
      progressMessage: job.progressInfo.message,
    };
  }

  // Queued or just started before progress.json is written
  return {
    ...job,
    stageIndex: 0,
    stageId: PIPELINE_STAGES[0].id,
    progress: 0.04,
    progressMessage: "Starting clipper pipeline...",
  };
}

export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, isNaN(seconds) ? 0 : seconds);
  const s = Math.floor(safe);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
