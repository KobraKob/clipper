import { spawn } from "child_process";
import { openSync, closeSync, promises as fs } from "fs";
import path from "path";
import { buildPreviewClips, hydrateJob } from "./pipeline";
import type { Clip, CreateJobInput, Job, JobView } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "jobs.json");

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

async function readJobs(): Promise<Job[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    return JSON.parse(raw) as Job[];
  } catch {
    return [];
  }
}

async function writeJobs(jobs: Job[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(jobs, null, 2), "utf8");
}

function persistHydration(job: Job, view: JobView): Job {
  if (view.status === "done" && job.status !== "done") {
    return {
      ...job,
      status: "done",
      clips: view.clips,
    };
  }
  return job;
}

async function spawnClipperProcess(job: Job): Promise<void> {
  try {
    const rootDir = await resolveRootDir();
    const workDir = path.join(rootDir, "workdir", job.id);
    const outDir = path.join(rootDir, "outputs", job.id);
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

    if (!job.vertical) args.push("--no-vertical");
    if (!job.captions) args.push("--no-captions");

    const child = spawn("python", args, {
      cwd: rootDir,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    });

    child.on("close", async (code) => {
      try {
        closeSync(logFd);
      } catch {
        // already closed
      }

      if (code !== 0) {
        let errSnippet = "";
        try {
          const logContent = await fs.readFile(logFile, "utf8");
          const lines = logContent.trim().split("\n");
          errSnippet = lines.slice(-4).join(" ").trim();
        } catch {
          // unable to read log
        }

        const currentJobs = await readJobs();
        const idx = currentJobs.findIndex((j) => j.id === job.id);
        if (idx !== -1 && currentJobs[idx].status !== "done") {
          currentJobs[idx].status = "error";
          currentJobs[idx].error = errSnippet || `Process failed with exit code ${code}`;
          await writeJobs(currentJobs);
        }
      }
    });

    child.unref();

    const metaFile = path.join(outDir, "metadata.json");
    let attempts = 0;

    const interval = setInterval(async () => {
      attempts += 1;
      if (attempts > 180) {
        clearInterval(interval);
        return;
      }

      try {
        const raw = await fs.readFile(metaFile, "utf8");
        const manifest = JSON.parse(raw);
        clearInterval(interval);

        const currentJobs = await readJobs();
        const idx = currentJobs.findIndex((j) => j.id === job.id);
        if (idx !== -1) {
          currentJobs[idx].status = "done";
          currentJobs[idx].clips = (manifest.clips || []).map((c: any) => ({
            id: `clip-${c.rank}`,
            title: c.title,
            hook: c.hook,
            reason: c.reason,
            score: c.score,
            start: c.start,
            end: c.end,
            text: c.hook || c.title,
            kept: true,
            file: c.file,
          }));
          await writeJobs(currentJobs);
        }
      } catch {
        // Output not written yet
      }
    }, 2000);
    interval.unref();
  } catch {
    // Graceful fallback
  }
}

export async function listJobs(): Promise<JobView[]> {
  const jobs = await readJobs();
  const now = Date.now();
  const views = jobs.map((job) => hydrateJob(job, now));
  const next = jobs.map((job, i) => persistHydration(job, views[i]));
  if (JSON.stringify(next) !== JSON.stringify(jobs)) {
    await writeJobs(next);
  }
  return views.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getJob(id: string): Promise<JobView | null> {
  const jobs = await readJobs();
  const index = jobs.findIndex((job) => job.id === id);
  if (index === -1) return null;
  const view = hydrateJob(jobs[index]);
  const persisted = persistHydration(jobs[index], view);
  if (persisted !== jobs[index]) {
    jobs[index] = persisted;
    await writeJobs(jobs);
  }
  return hydrateJob(persisted);
}

export async function createJob(input: CreateJobInput): Promise<JobView> {
  const source = (input.sourceUrl || input.fileName || "").trim();
  if (!source) {
    throw new Error("Please specify a video URL or local file path.");
  }

  const isUrl = /^https?:\/\//i.test(source);
  const clipCount = Math.min(8, Math.max(1, Math.round(input.clipCount) || 5));
  const now = Date.now();

  const job: Job = {
    id: `job-${now.toString(36)}-${Math.floor(Math.random() * 1000).toString(36)}`,
    source,
    sourceKind: isUrl ? "url" : "file",
    clipCount,
    provider: input.provider === "groq" ? "groq" : "local",
    vertical: Boolean(input.vertical),
    captions: Boolean(input.captions),
    createdAt: now,
    startedAt: now,
    status: "running",
    clips: [],
  };

  const jobs = await readJobs();
  jobs.push(job);
  await writeJobs(jobs);

  // Trigger real pipeline runner in background
  void spawnClipperProcess(job);

  return hydrateJob(job, now);
}

export async function patchClip(
  jobId: string,
  clipId: string,
  patch: Partial<Pick<Clip, "kept" | "start" | "end">>,
): Promise<JobView> {
  const jobs = await readJobs();
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index === -1) {
    throw new Error("Job not found.");
  }
  const view = hydrateJob(jobs[index]);
  const clips = (view.clips.length ? view.clips : buildPreviewClips(view.source, view.clipCount)).map(
    (clip) => {
      if (clip.id !== clipId) return clip;
      const next = { ...clip, ...patch };
      if (next.end <= next.start) {
        throw new Error("End timestamp must be strictly greater than start timestamp.");
      }
      return next;
    },
  );
  jobs[index] = {
    ...jobs[index],
    status: "done",
    clips,
  };
  await writeJobs(jobs);
  return hydrateJob(jobs[index]);
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

  // Check default outputs location
  const rootDir = await resolveRootDir();
  const candidateDir = path.join(rootDir, "outputs", jobId);
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
