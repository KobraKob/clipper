import { spawn } from "child_process";
import { openSync, closeSync, promises as fs } from "fs";
import path from "path";
import { hydrateJob } from "./pipeline";
import type { Clip, CreateJobInput, Job, JobView, Platform, ProgressInfo } from "./types";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "jobs.json");
const WORKDIR_DIR_ENV = process.env.WORKDIR_DIR;
const OUTPUTS_DIR_ENV = process.env.OUTPUTS_DIR;
const PYTHON = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");

const ALLOWED_VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".flv"]);

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

async function readJobs(): Promise<Job[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    return JSON.parse(raw) as Job[];
  } catch {
    return [];
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
  try {
    const workDir = await resolveWorkDir(jobId);
    const progressPath = path.join(workDir, "progress.json");
    const raw = await fs.readFile(progressPath, "utf8");
    return JSON.parse(raw) as ProgressInfo;
  } catch {
    try {
      const outDir = await resolveOutDir(jobId);
      const raw = await fs.readFile(path.join(outDir, "progress.json"), "utf8");
      return JSON.parse(raw) as ProgressInfo;
    } catch {
      return undefined;
    }
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
    start: c.start,
    end: c.end,
    text: c.hook || c.title,
    kept: true,
    file: c.file,
    captionStyle: c.caption_style ?? null,
    encoder: c.encoder ?? undefined,
    seo: c.seo,
    publish: c.publish || {},
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

    const child = spawn(PYTHON, args, {
      cwd: rootDir,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    });

    child.on("close", async (code) => {
      try {
        closeSync(logFd);
      } catch {
        // already closed
      }

      await storeMutex.runExclusive(async () => {
        // Check if manifest was produced on disk first (even if process had non-zero exit code)
        let manifest: any = null;
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
  const views: JobView[] = [];
  let updatedAny = false;

  for (const job of jobs) {
    // Self-heal: If metadata.json exists on disk with clips, rehydrate and mark as done
    if (job.status !== "done" || !job.clips || job.clips.length === 0) {
      try {
        const outDir = await resolveOutDir(job.id);
        const raw = await fs.readFile(path.join(outDir, "metadata.json"), "utf8");
        const manifest = JSON.parse(raw);
        if (manifest && Array.isArray(manifest.clips) && manifest.clips.length > 0) {
          job.status = "done";
          job.clips = mapManifestClips(manifest);
          delete job.error;
          updatedAny = true;
        }
      } catch {
        // No metadata.json on disk
      }
    }

    if (job.status === "running") {
      const p = await readProgress(job.id);
      if (p) job.progressInfo = p;
    }
    views.push(hydrateJob(job));
  }

  if (updatedAny) {
    void storeMutex.runExclusive(async () => {
      await writeJobs(jobs);
    });
  }

  return views.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getJob(id: string): Promise<JobView | null> {
  const jobs = await readJobs();
  const index = jobs.findIndex((job) => job.id === id);
  if (index === -1) return null;

  const job = jobs[index];

  // Self-heal: If metadata.json exists on disk with clips, rehydrate and mark done
  if (job.status !== "done" || !job.clips || job.clips.length === 0) {
    try {
      const outDir = await resolveOutDir(job.id);
      const raw = await fs.readFile(path.join(outDir, "metadata.json"), "utf8");
      const manifest = JSON.parse(raw);
      if (manifest && Array.isArray(manifest.clips) && manifest.clips.length > 0) {
        job.status = "done";
        job.clips = mapManifestClips(manifest);
        delete job.error;
        await storeMutex.runExclusive(async () => {
          const fresh = await readJobs();
          const i = fresh.findIndex((j) => j.id === job.id);
          if (i !== -1) {
            fresh[i].status = "done";
            fresh[i].clips = job.clips;
            delete fresh[i].error;
            await writeJobs(fresh);
          }
        });
      }
    } catch {
      // No metadata on disk
    }
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

  const clipCount = Math.min(8, Math.max(1, Math.round(input.clipCount) || 5));
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
    provider: input.provider === "groq" ? "groq" : "local",
    vertical: Boolean(input.vertical),
    captions: Boolean(input.captions),
    captionStyle: /^[a-z_]{2,30}$/.test(input.captionStyle || "") ? (input.captionStyle as string) : "bold_pop",
    layout: input.layout === "fit_blur" ? "fit_blur" : "fill",
    videoEncoder,
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
        PYTHON,
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
    const files = await fs.readdir(candidateDir);
    const match = files.find((f) => f.includes(clipId.replace("clip-", "")) && f.endsWith(".mp4"));
    if (match) {
      return path.join(candidateDir, match);
    }
  } catch {
    // dir doesn't exist
  }

  return null;
}

/** Upload one clip to YouTube Shorts and/or Instagram Reels via the Python CLI, then sync the manifest back. */
export async function publishClip(jobId: string, clipId: string, platforms: Platform[]): Promise<JobView> {
  return storeMutex.runExclusive(async () => {
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
        publishArgs.push("--privacy", "public");
      }

      await new Promise<void>((resolve) => {
        const child = spawn(
          PYTHON,
          publishArgs,
          {
            cwd: rootDir,
            stdio: "ignore",
            windowsHide: false,
            env: {
              ...process.env,
              PYTHONIOENCODING: "utf-8",
              PYTHONUTF8: "1",
            },
          },
        );
        child.on("close", () => resolve());
        child.on("error", () => resolve());
      });
    }

    const raw = JSON.parse(await fs.readFile(manifest, "utf8"));
    const fresh = mapManifestClips(raw);
    const current = await readJobs();
    const i = current.findIndex((j) => j.id === jobId);
    if (i !== -1) {
      current[i].clips = current[i].clips.map((c) => {
        const f = fresh.find((x) => x.id === c.id);
        return f ? { ...c, publish: f.publish, seo: f.seo ?? c.seo } : c;
      });
      await writeJobs(current);
      return hydrateJob(current[i]);
    }
    throw new Error("Job not found.");
  });
}

