import { spawn } from "child_process";
import { openSync, closeSync, promises as fs } from "fs";
import path from "path";
import { hydrateJob } from "./pipeline";
import type { Clip, CreateJobInput, Job, JobView, Platform, ProgressInfo } from "./types";
import { readLogTail } from "./logTail";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "jobs.json");
const WORKDIR_DIR_ENV = process.env.WORKDIR_DIR;
const OUTPUTS_DIR_ENV = process.env.OUTPUTS_DIR;
const PYTHON = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");

const ALLOWED_VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".flv"]);
const ALLOWED_SOUNDTRACK_EXTS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);

/** Mutex ensuring all reads and mutations of jobs.json are atomic and strictly serialized. */
class Mutex {
  private queue = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void = () => {};
    const lockPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const currentQueue = this.queue;
    this.queue = currentQueue.then(() => lockPromise);
    await currentQueue;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const storeMutex = new Mutex();

async function resolveRootDir(): Promise<string> {
  const current = process.cwd();
  try {
    const stat = await fs.stat(path.join(current, "clipper"));
    if (stat.isDirectory()) return current;
  } catch {
    // not in root
  }
  return path.resolve(current, "..");
}

async function resolveWorkDir(jobId: string): Promise<string> {
  if (WORKDIR_DIR_ENV) return path.join(WORKDIR_DIR_ENV, jobId);
  const root = await resolveRootDir();
  return path.join(root, "workdir", jobId);
}

async function resolveOutDir(jobId: string): Promise<string> {
  if (OUTPUTS_DIR_ENV) return path.join(OUTPUTS_DIR_ENV, jobId);
  const root = await resolveRootDir();
  return path.join(root, "outputs", jobId);
}

async function validateUploadedSoundtrack(filePath: string): Promise<string> {
  const resolved = path.resolve(filePath);
  if (!ALLOWED_SOUNDTRACK_EXTS.has(path.extname(resolved).toLowerCase())) {
    throw new Error("Soundtrack must be MP3, WAV, M4A, AAC, OGG or FLAC.");
  }

  const rootDir = await resolveRootDir();
  const allowedRoot = path.resolve(rootDir, "workdir", "soundtracks");
  const lexicalRelative = path.relative(allowedRoot, resolved);
  if (!lexicalRelative || lexicalRelative.startsWith("..") || path.isAbsolute(lexicalRelative)) {
    throw new Error("Soundtrack must be uploaded through Clipper.");
  }

  try {
    const realRoot = await fs.realpath(allowedRoot);
    const realFile = await fs.realpath(resolved);
    const realRelative = path.relative(realRoot, realFile);
    if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new Error("Soundtrack path escapes the upload directory.");
    }
    const stat = await fs.stat(realFile);
    if (!stat.isFile()) throw new Error("Soundtrack path is not a regular file.");
    return realFile;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Soundtrack")) throw error;
    throw new Error("Uploaded soundtrack file could not be found.");
  }
}

async function readJobs(): Promise<Job[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`Invalid job store format in ${DATA_FILE}: expected an array.`);
    }
    return parsed as Job[];
  } catch (error) {
    // A missing file means a new store. Corruption or permission errors must not
    // silently become an empty store, or the next write could erase existing jobs.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}

/** Atomic write via temporary file rename under mutex protection. */
async function writeJobs(jobs: Job[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempFile = path.join(
    DATA_DIR,
    `jobs.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  await fs.writeFile(tempFile, JSON.stringify(jobs, null, 2), "utf8");
  await fs.rename(tempFile, DATA_FILE);
}

async function readProgress(jobId: string): Promise<ProgressInfo | undefined> {
  const workDir = await resolveWorkDir(jobId);
  const outDir = await resolveOutDir(jobId);

  const candidatePaths: string[] = [
    path.join(workDir, "progress.json"),
    path.join(outDir, "progress.json"),
  ];

  try {
    const entries = await fs.readdir(/*turbopackIgnore: true*/ workDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith("job_")) {
        candidatePaths.push(path.join(workDir, entry.name, "progress.json"));
      }
    }
  } catch {
    // workDir might not exist yet
  }

  for (const p of candidatePaths) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await fs.readFile(/*turbopackIgnore: true*/ p, "utf8");
        return JSON.parse(raw) as ProgressInfo;
      } catch (err: unknown) {
        if (
          attempt === 0 &&
          err &&
          typeof err === "object" &&
          "code" in err &&
          ((err as NodeJS.ErrnoException).code === "EBUSY" || (err as NodeJS.ErrnoException).code === "EPERM")
        ) {
          await new Promise((r) => setTimeout(r, 40));
          continue;
        }
        break;
      }
    }
  }
  return undefined;
}

export async function getJobLogs(jobId: string, maxLines = 100): Promise<string> {
  try {
    const workDir = await resolveWorkDir(jobId);
    const logPath = path.join(workDir, "clipper.log");
    return await readLogTail(logPath, maxLines);
  } catch {
    return "";
  }
}

function isAllowedLocalVideoPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_VIDEO_EXTS.has(ext)) {
    return false;
  }
  const lower = resolved.toLowerCase();
  // Disallow critical OS system directories
  if (
    lower.startsWith("c:\\windows") ||
    lower.startsWith("c:\\program files") ||
    lower.startsWith("/etc") ||
    lower.startsWith("/sys") ||
    lower.startsWith("/proc") ||
    lower.startsWith("/root")
  ) {
    return false;
  }
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapManifestClips(manifest: any): Clip[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (manifest.clips || []).map((c: any) => ({
    id: `clip-${c.rank}`,
    title: c.seo?.youtube?.title || c.title,
    hook: c.hook,
    reason: c.reason,
    score: c.score,
    scoreBreakdown: c.score_breakdown,
    soundtrack: c.soundtrack,
    start: c.start,
    end: c.end,
    text: c.hook || c.title,
    kept: true,
    file: c.file,
    coverImage: c.cover_image || c.cover_path || undefined,
    captionStyle: c.caption_style ?? null,
    encoder: c.encoder ?? undefined,
    hookOverlay: c.hook_overlay,
    progressBar: c.progress_bar,
    loudnorm: c.loudnorm,
    titleVariants: c.title_variants || c.seo?.title_variants || [],
    selectedTitleVariant: c.selected_title_variant || c.seo?.selected_title_variant || "direct",
    seo: c.seo,
    publish: c.publish || {},
    schedule: c.schedule,
    analytics: c.analytics,
  }));
}

async function spawnClipperProcess(job: Job): Promise<void> {
  try {
    const rootDir = await resolveRootDir();
    const workDir = await resolveWorkDir(job.id);
    const outDir = await resolveOutDir(job.id);
    await fs.mkdir(workDir, { recursive: true });
    await fs.mkdir(outDir, { recursive: true });

    const logFile = path.join(workDir, "clipper.log");
    const logFd = openSync(logFile, "w");

    const args = [
      "-m",
      "clipper.cli",
      "run",
      job.source,
      "-n",
      String(job.clipCount),
      "-p",
      job.provider,
      "--workdir",
      workDir,
      "--outdir",
      outDir,
    ];

    args.push("--caption-style", job.captionStyle || "bold_pop");
    args.push("--layout", job.layout || "fill");
    if (!job.vertical) args.push("--no-vertical");
    if (!job.captions) args.push("--no-captions");
    if (job.videoEncoder && job.videoEncoder !== "auto") {
      args.push("--encoder", job.videoEncoder);
    }
    if (job.trimSilence) args.push("--trim-silence");
    if (job.hookOverlay === false) args.push("--no-hook-overlay");
    if (job.progressBar) args.push("--progress-bar");
    if (job.loudnorm === false) args.push("--no-loudnorm");
    if (job.soundtrackPath) {
      args.push("--soundtrack", job.soundtrackPath);
      args.push("--soundtrack-volume", String(job.soundtrackVolume ?? 0.18));
    }

    const child = spawn(/*turbopackIgnore: true*/ PYTHON, args, {
      cwd: rootDir,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    });

    child.on("error", async (error) => {
      try {
        closeSync(logFd);
      } catch {
        // The close handler may already have closed the descriptor.
      }
      console.error("[clipper] Failed to start child process:", error);
      await storeMutex.runExclusive(async () => {
        const currentJobs = await readJobs();
        const idx = currentJobs.findIndex((j) => j.id === job.id);
        if (idx === -1 || currentJobs[idx].status === "done") return;
        currentJobs[idx].status = "error";
        currentJobs[idx].error = `Could not start clipper process: ${error.message}`;
        await writeJobs(currentJobs);
      });
    });

    child.on("close", async (code) => {
      try {
        closeSync(logFd);
      } catch {
        // already closed
      }

      await storeMutex.runExclusive(async () => {
        // Check if manifest was produced on disk first (even if process had non-zero exit code)
        let manifest: Record<string, unknown> | null = null;
        try {
          const raw = await fs.readFile(path.join(outDir, "metadata.json"), "utf8");
          manifest = JSON.parse(raw);
        } catch {
          manifest = null;
        }

        const currentJobs = await readJobs();
        const idx = currentJobs.findIndex((j) => j.id === job.id);
        if (idx === -1) return;

        if (manifest && Array.isArray(manifest.clips) && manifest.clips.length > 0) {
          currentJobs[idx].status = "done";
          currentJobs[idx].clips = mapManifestClips(manifest);
          delete currentJobs[idx].error;
          await writeJobs(currentJobs);
          return;
        }

        if (code === 0) {
          if (manifest) {
            currentJobs[idx].status = "done";
            currentJobs[idx].clips = mapManifestClips(manifest);
            await writeJobs(currentJobs);
          }
        } else {
          let errSnippet = "";
          try {
            const logContent = await fs.readFile(logFile, "utf8");
            const lines = logContent.trim().split("\n");
            errSnippet = lines.slice(-4).join(" ").trim();
          } catch {
            // unable to read log
          }

          if (currentJobs[idx].status !== "done") {
            currentJobs[idx].status = "error";
            currentJobs[idx].error = errSnippet || `Process failed with exit code ${code}`;
            await writeJobs(currentJobs);
          }
        }
      });
    });

    child.unref();

    const metaFile = path.join(outDir, "metadata.json");
    let attempts = 0;

    const interval = setInterval(async () => {
      attempts += 1;
      if (attempts > 300) {
        clearInterval(interval);
        return;
      }

      try {
        const raw = await fs.readFile(metaFile, "utf8");
        const manifest = JSON.parse(raw);
        clearInterval(interval);

        await storeMutex.runExclusive(async () => {
          const currentJobs = await readJobs();
          const idx = currentJobs.findIndex((j) => j.id === job.id);
          if (idx !== -1 && currentJobs[idx].status !== "done") {
            currentJobs[idx].status = "done";
            currentJobs[idx].clips = mapManifestClips(manifest);
            delete currentJobs[idx].error;
            await writeJobs(currentJobs);
          }
        });
      } catch {
        // Output not written yet
      }
    }, 1500);
    interval.unref();
  } catch {
    // Process launch error
  }
}

export async function listJobs(): Promise<JobView[]> {
  const jobs = await readJobs();

  // Jobs are independent. Resolve disk metadata and progress concurrently instead
  // of serially waiting on every file for every library refresh.
  const results = await Promise.all(
    jobs.map(async (job) => {
      let recoveredClips: Clip[] | undefined;

      // Self-heal: Recover completed clips when the job record is incomplete.
      if (job.status !== "done" || !job.clips || job.clips.length === 0) {
        try {
          const outDir = await resolveOutDir(job.id);
          const raw = await fs.readFile(path.join(outDir, "metadata.json"), "utf8");
          const manifest = JSON.parse(raw);
          if (manifest && Array.isArray(manifest.clips) && manifest.clips.length > 0) {
            recoveredClips = mapManifestClips(manifest);
            job.status = "done";
            job.clips = recoveredClips;
            delete job.error;
          }
        } catch {
          // No metadata.json on disk
        }
      }

      if (job.status === "running") {
        const progress = await readProgress(job.id);
        if (progress) job.progressInfo = progress;
      }

      return { jobId: job.id, view: hydrateJob(job), recoveredClips };
    }),
  );

  const recoveries = results.filter((result) => result.recoveredClips);
  if (recoveries.length > 0) {
    // Merge self-healing changes into the latest store snapshot while holding the
    // mutex. Writing the stale snapshot captured above could otherwise overwrite
    // a job created or updated during the filesystem reads.
    await storeMutex.runExclusive(async () => {
      const latestJobs = await readJobs();
      const recoveredById = new Map<string, Clip[]>();
      for (const result of recoveries) {
        if (result.recoveredClips) recoveredById.set(result.jobId, result.recoveredClips);
      }

      const mergedJobs = latestJobs.map((current) => {
        const clips = recoveredById.get(current.id);
        if (!clips || (current.status === "done" && current.clips?.length)) return current;

        const recovered: Job = { ...current, status: "done", clips };
        delete recovered.error;
        return recovered;
      });
      await writeJobs(mergedJobs);
    });
  }

  return results.map((result) => result.view).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getJob(id: string): Promise<JobView | null> {
  const jobs = await readJobs();
  const index = jobs.findIndex((job) => job.id === id);
  if (index === -1) return null;

  const job = jobs[index];

  // Self-heal & sync latest clip status (including live upload progress):
  try {
    const outDir = await resolveOutDir(job.id);
    const raw = await fs.readFile(path.join(outDir, "metadata.json"), "utf8");
    const manifest = JSON.parse(raw);
    if (manifest && Array.isArray(manifest.clips) && manifest.clips.length > 0) {
      const freshClips = mapManifestClips(manifest);
      job.clips = freshClips;
      if (job.status !== "done") {
        job.status = "done";
        delete job.error;
      }
    }
  } catch {
    // No metadata on disk
  }

  if (job.status === "running") {
    const p = await readProgress(job.id);
    if (p) job.progressInfo = p;
  }
  return hydrateJob(job);
}

export async function createJob(input: CreateJobInput): Promise<JobView> {
  const source = (input.sourceUrl || input.fileName || "").trim();
  if (!source) {
    throw new Error("Please specify a video URL or local file path.");
  }

  const isUrl = /^https?:\/\//i.test(source);
  if (!isUrl) {
    if (!isAllowedLocalVideoPath(source)) {
      throw new Error("Invalid or prohibited file path. Please select a valid video file (.mp4, .mov, etc.).");
    }
    try {
      const stat = await fs.stat(source);
      if (!stat.isFile()) throw new Error("Path is not a regular file.");
    } catch {
      throw new Error(`Local video file not found at: ${source}`);
    }
  }

  const clipCount = Math.min(10, Math.max(1, Math.round(input.clipCount) || 5));
  const soundtrackPath = input.soundtrackPath?.trim() ? await validateUploadedSoundtrack(input.soundtrackPath.trim()) : undefined;
  const requestedSoundtrackVolume = Number(input.soundtrackVolume ?? 0.18);
  const soundtrackVolume = Number.isFinite(requestedSoundtrackVolume) ? Math.min(0.4, Math.max(0.05, requestedSoundtrackVolume)) : 0.18;
  const now = Date.now();
  const validEncoders = new Set(["auto", "h264_nvenc", "libx264", "h264_qsv"]);
  const videoEncoder = (input.videoEncoder && validEncoders.has(input.videoEncoder))
    ? input.videoEncoder
    : "auto";

  const job: Job = {
    id: `job-${now.toString(36)}-${Math.floor(Math.random() * 1000).toString(36)}`,
    source,
    sourceKind: isUrl ? "url" : "file",
    clipCount,
    provider: input.provider === "groq" ? "groq" : input.provider === "openrouter" ? "openrouter" : "local",
    vertical: Boolean(input.vertical),
    captions: Boolean(input.captions),
    captionStyle: /^[a-z_]{2,30}$/.test(input.captionStyle || "") ? (input.captionStyle as string) : "bold_pop",
    layout: input.layout === "fit_blur" ? "fit_blur" : input.layout === "split_screen" ? "split_screen" : "fill",
    videoEncoder,
    trimSilence: Boolean(input.trimSilence),
    hookOverlay: input.hookOverlay !== false,
    progressBar: Boolean(input.progressBar),
    loudnorm: input.loudnorm !== false,
    soundtrackPath,
    soundtrackVolume,
    createdAt: now,
    startedAt: now,
    status: "running",
    clips: [],
    progressInfo: {
      stage: "ingest",
      percent: 4,
      message: "Queuing clipper process...",
    },
  };

  return storeMutex.runExclusive(async () => {
    const jobs = await readJobs();
    jobs.push(job);
    await writeJobs(jobs);

    // Trigger real pipeline runner in background
    void spawnClipperProcess(job);

    return hydrateJob(job);
  });
}

export async function deleteJob(id: string): Promise<boolean> {
  return storeMutex.runExclusive(async () => {
    const jobs = await readJobs();
    const index = jobs.findIndex((j) => j.id === id);
    if (index === -1) return false;

    const updatedJobs = jobs.filter((j) => j.id !== id);
    await writeJobs(updatedJobs);

    const workDir = await resolveWorkDir(id);
    const outDir = await resolveOutDir(id);
    const progressFile = path.join(DATA_DIR, `progress-${id}.json`);

    await Promise.allSettled([
      fs.rm(workDir, { recursive: true, force: true }),
      fs.rm(outDir, { recursive: true, force: true }),
      fs.unlink(progressFile),
    ]);

    return true;
  });
}

export async function setJobClips(jobId: string, clips: Clip[]): Promise<JobView> {
  return storeMutex.runExclusive(async () => {
    const jobs = await readJobs();
    const index = jobs.findIndex((j) => j.id === jobId);
    if (index === -1) throw new Error("Job not found.");
    jobs[index].clips = clips;
    jobs[index].status = "done";
    await writeJobs(jobs);
    return hydrateJob(jobs[index]);
  });
}

export async function patchClip(
  jobId: string,
  clipId: string,
  patch: Partial<Pick<Clip, "kept" | "start" | "end">>,
): Promise<JobView> {
  return storeMutex.runExclusive(async () => {
    const jobs = await readJobs();
    const index = jobs.findIndex((job) => job.id === jobId);
    if (index === -1) {
      throw new Error("Job not found.");
    }

    const job = jobs[index];
    const target = job.clips.find((c) => c.id === clipId);
    if (!target) {
      throw new Error(`Clip ${clipId} not found.`);
    }

    const nextPatch = { ...target, ...patch };
    if (nextPatch.end <= nextPatch.start) {
      throw new Error("End timestamp must be strictly greater than start timestamp.");
    }

    const clips = job.clips.map((clip) => {
      if (clip.id !== clipId) return clip;
      return nextPatch;
    });

    jobs[index] = {
      ...jobs[index],
      clips,
    };
    await writeJobs(jobs);
    return hydrateJob(jobs[index]);
  });
}

export async function rerenderClip(
  jobId: string,
  clipId: string,
  start: number,
  end: number,
): Promise<JobView> {
  return storeMutex.runExclusive(async () => {
    const jobs = await readJobs();
    const index = jobs.findIndex((j) => j.id === jobId);
    if (index === -1) throw new Error("Job not found.");
    const job = jobs[index];
    const rank = Number(clipId.replace("clip-", ""));
    if (!Number.isInteger(rank)) throw new Error("Invalid clip id.");

    const rootDir = await resolveRootDir();
    const outDir = await resolveOutDir(jobId);
    const manifest = path.join(outDir, "metadata.json");
    await fs.access(manifest).catch(() => {
      throw new Error("This job has no exported clips yet.");
    });

    const rerenderArgs = [
      "-m",
      "clipper.cli",
      "rerender",
      manifest,
      "--rank",
      String(rank),
      "--start",
      String(start),
      "--end",
      String(end),
    ];
    if (job.videoEncoder && job.videoEncoder !== "auto") {
      rerenderArgs.push("--encoder", job.videoEncoder);
    }

    const code = await new Promise<number>((resolve) => {
      const child = spawn(
        /*turbopackIgnore: true*/ PYTHON,
        rerenderArgs,
        { cwd: rootDir, stdio: "ignore", windowsHide: true },
      );
      child.on("close", (c) => resolve(c ?? 1));
      child.on("error", () => resolve(1));
    });

    if (code !== 0) {
      throw new Error(`Re-rendering clip failed with exit code ${code}`);
    }

    const raw = JSON.parse(await fs.readFile(manifest, "utf8"));
    const fresh = mapManifestClips(raw);
    const current = await readJobs();
    const i = current.findIndex((j) => j.id === jobId);
    if (i !== -1) {
      current[i].clips = fresh;
      await writeJobs(current);
      return hydrateJob(current[i]);
    }
    throw new Error("Job not found.");
  });
}

export async function getClipVideoFile(jobId: string, clipId: string): Promise<string | null> {
  const jobs = await readJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;

  const clip = job.clips.find((c) => c.id === clipId);
  if (clip?.file) {
    try {
      await fs.access(clip.file);
      return clip.file;
    } catch {
      // file path invalid
    }
  }

  // Check outputs location
  const candidateDir = await resolveOutDir(jobId);
  try {
    const files = await fs.readdir(/*turbopackIgnore: true*/ candidateDir);
    const match = files.find((f) => f.includes(clipId.replace("clip-", "")) && f.endsWith(".mp4"));
    if (match) {
      return path.join(candidateDir, match);
    }
  } catch {
    // dir doesn't exist
  }

  return null;
}

export async function getClipCoverFile(jobId: string, clipId: string): Promise<string | null> {
  const jobs = await readJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;

  const clip = job.clips.find((c) => c.id === clipId);
  if (clip?.coverImage) {
    try {
      await fs.access(clip.coverImage);
      return clip.coverImage;
    } catch {
      // not accessible
    }
  }

  const candidateDir = await resolveOutDir(jobId);
  try {
    const files = await fs.readdir(/*turbopackIgnore: true*/ candidateDir);
    const rank = clipId.replace("clip-", "");
    const match = files.find(
      (f) => (f.startsWith(`${rank.padStart(2, "0")}_`) || f.includes(rank)) && f.endsWith("_cover.jpg"),
    );
    if (match) {
      return path.join(candidateDir, match);
    }
  } catch {
    // dir doesn't exist
  }

  return null;
}

/** Upload one clip to YouTube Shorts and/or Instagram Reels via the Python CLI, then sync the manifest back. */
export async function resetYouTubeToken(): Promise<{ success: boolean; message: string }> {
  const rootDir = await resolveRootDir();
  const tokenFile = path.join(rootDir, "credentials", "youtube_token.json");
  try {
    await fs.unlink(tokenFile);
    return { success: true, message: "YouTube account disconnected. Click Publish to choose another channel." };
  } catch {
    return { success: true, message: "No active token file found." };
  }
}

export async function publishClip(
  jobId: string,
  clipId: string,
  platforms: Platform[],
  privacy?: "private" | "unlisted" | "public",
  reauth?: boolean,
): Promise<JobView> {
  const jobs = await readJobs();
  const index = jobs.findIndex((j) => j.id === jobId);
  if (index === -1) throw new Error("Job not found.");
  const rank = Number(clipId.replace("clip-", ""));
  if (!Number.isInteger(rank)) throw new Error("Invalid clip id.");
  const valid = platforms.filter((p): p is Platform => p === "youtube" || p === "instagram");
  if (!valid.length) throw new Error("Choose YouTube and/or Instagram.");

  const rootDir = await resolveRootDir();
  const outDir = await resolveOutDir(jobId);
  const manifest = path.join(outDir, "metadata.json");
  await fs.access(manifest).catch(() => {
    throw new Error("This job has no exported clips yet.");
  });

  const chosenPrivacy = privacy || "private";

  for (const platform of valid) {
    const publishArgs = [
      "-m",
      "clipper.cli",
      "publish",
      manifest,
      "--rank",
      String(rank),
      "--platform",
      platform,
    ];
    if (platform === "youtube") {
      publishArgs.push("--privacy", chosenPrivacy);
      if (reauth) {
        publishArgs.push("--reauth");
      }
    }

    let stderrOutput = "";
    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn(
        /*turbopackIgnore: true*/ PYTHON,
        publishArgs,
        {
          cwd: rootDir,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: false,
          env: {
            ...process.env,
            PYTHONIOENCODING: "utf-8",
            PYTHONUTF8: "1",
          },
        },
      );
      child.stdout?.on("data", (chunk) => {
        const text = chunk.toString().trim();
        if (text) console.log(`[publish] ${text}`);
      });
      child.stderr?.on("data", (chunk) => {
        const text = chunk.toString();
        stderrOutput += text;
        console.error(`[publish error] ${text.trim()}`);
      });
      child.on("close", (code) => resolve(code ?? 0));
      child.on("error", (err) => {
        stderrOutput += err.message;
        resolve(1);
      });
    });

    if (exitCode !== 0) {
      console.warn(`[publish] Platform ${platform} exited with code ${exitCode}: ${stderrOutput}`);
    }
  }

  const raw = JSON.parse(await fs.readFile(manifest, "utf8"));
  const fresh = mapManifestClips(raw);

  return storeMutex.runExclusive(async () => {
    const current = await readJobs();
    const i = current.findIndex((j) => j.id === jobId);
    if (i !== -1) {
      current[i].clips = current[i].clips.map((c) => {
        const f = fresh.find((x) => x.id === c.id);
        return f ? { ...c, publish: f.publish, seo: f.seo ?? c.seo, schedule: f.schedule, analytics: f.analytics } : c;
      });
      await writeJobs(current);
      return hydrateJob(current[i]);
    }
    throw new Error("Job not found.");
  });
}

/** Assign a scheduled post time to a clip. */
export async function scheduleClip(
  jobId: string,
  clipId: string,
  platform: Platform | "both",
  scheduledAtIso: string,
): Promise<JobView> {
  return storeMutex.runExclusive(async () => {
    const jobs = await readJobs();
    const index = jobs.findIndex((j) => j.id === jobId);
    if (index === -1) throw new Error("Job not found.");
    const rank = Number(clipId.replace("clip-", ""));
    if (!Number.isInteger(rank)) throw new Error("Invalid clip id.");

    const rootDir = await resolveRootDir();
    const outDir = await resolveOutDir(jobId);
    const manifest = path.join(outDir, "metadata.json");
    await fs.access(manifest).catch(() => {
      throw new Error("This job has no exported clips yet.");
    });

    const code = await new Promise<number>((resolve) => {
      const child = spawn(
        /*turbopackIgnore: true*/ PYTHON,
        ["-m", "clipper.cli", "schedule", manifest, "--rank", String(rank), "--time", scheduledAtIso, "--platform", platform],
        { cwd: rootDir, stdio: "ignore", windowsHide: true },
      );
      child.on("close", (c) => resolve(c ?? 1));
      child.on("error", () => resolve(1));
    });

    if (code !== 0) {
      throw new Error(`Scheduling clip failed with code ${code}`);
    }

    const raw = JSON.parse(await fs.readFile(manifest, "utf8"));
    const fresh = mapManifestClips(raw);
    const current = await readJobs();
    const i = current.findIndex((j) => j.id === jobId);
    if (i !== -1) {
      current[i].clips = fresh;
      await writeJobs(current);
      return hydrateJob(current[i]);
    }
    throw new Error("Job not found.");
  });
}

/** Fetch live performance analytics for a clip from YouTube. */
export async function fetchClipAnalytics(jobId: string): Promise<JobView> {
  return storeMutex.runExclusive(async () => {
    const rootDir = await resolveRootDir();
    const outDir = await resolveOutDir(jobId);
    const manifest = path.join(outDir, "metadata.json");
    await fs.access(manifest).catch(() => {
      throw new Error("Job manifest not found.");
    });

    await new Promise<void>((resolve) => {
      const child = spawn(
        /*turbopackIgnore: true*/ PYTHON,
        ["-m", "clipper.cli", "analytics", manifest],
        { cwd: rootDir, stdio: "ignore", windowsHide: true },
      );
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    });

    const raw = JSON.parse(await fs.readFile(manifest, "utf8"));
    const fresh = mapManifestClips(raw);
    const current = await readJobs();
    const i = current.findIndex((j) => j.id === jobId);
    if (i !== -1) {
      current[i].clips = fresh;
      await writeJobs(current);
      return hydrateJob(current[i]);
    }
    throw new Error("Job not found.");
  });
}

/** Switch the active title variant for a clip. */
export async function selectClipTitleVariant(
  jobId: string,
  clipId: string,
  variantId: string,
): Promise<JobView> {
  return storeMutex.runExclusive(async () => {
    const current = await readJobs();
    const i = current.findIndex((j) => j.id === jobId);
    if (i === -1) throw new Error("Job not found.");

    current[i].clips = current[i].clips.map((c) => {
      if (c.id !== clipId) return c;
      const targetVar = c.titleVariants?.find((v) => v.id === variantId);
      if (!targetVar) return c;
      return {
        ...c,
        title: targetVar.title,
        selectedTitleVariant: variantId,
        seo: c.seo
          ? {
              ...c.seo,
              youtube: {
                ...c.seo.youtube,
                title: targetVar.title,
              },
            }
          : c.seo,
      };
    });

    await writeJobs(current);
    return hydrateJob(current[i]);
  });
}


