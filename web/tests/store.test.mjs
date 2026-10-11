import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createJob, deleteJob, getJob, listJobs, patchClip, setJobClips } from "../src/lib/store.ts";
import { formatTimecode, hydrateJob } from "../src/lib/pipeline.ts";

test("formatTimecode formats seconds correctly", () => {
  assert.equal(formatTimecode(0), "0:00");
  assert.equal(formatTimecode(59), "0:59");
  assert.equal(formatTimecode(60), "1:00");
  assert.equal(formatTimecode(125), "2:05");
  assert.equal(formatTimecode(3600), "60:00");
});

test("hydrateJob uses real progressInfo without simulating timers or inventing fake clips", () => {
  const job = {
    id: "job-test-real",
    source: "https://example.com/video.mp4",
    sourceKind: "url",
    clipCount: 3,
    provider: "local",
    vertical: true,
    captions: true,
    captionStyle: "bold_pop",
    layout: "fill",
    createdAt: Date.now(),
    startedAt: Date.now(),
    status: "running",
    clips: [],
    progressInfo: {
      stage: "score",
      percent: 55,
      message: "Scoring viral hooks...",
    },
  };

  const view = hydrateJob(job);
  assert.equal(view.stageId, "score");
  assert.equal(view.progress, 0.55);
  assert.equal(view.progressMessage, "Scoring viral hooks...");
  assert.equal(view.clips.length, 0); // Must NOT invent fake preview clips!
});

test("hydrateJob handles completed job with 0 clips truthfully", () => {
  const job = {
    id: "job-empty-done",
    source: "https://example.com/video.mp4",
    sourceKind: "url",
    clipCount: 3,
    provider: "local",
    vertical: true,
    captions: true,
    captionStyle: "bold_pop",
    layout: "fill",
    createdAt: Date.now(),
    startedAt: Date.now(),
    status: "done",
    clips: [],
  };

  const view = hydrateJob(job);
  assert.equal(view.status, "done");
  assert.equal(view.stageId, "done");
  assert.equal(view.progress, 1.0);
  assert.equal(view.clips.length, 0); // Zero clips preserved truthfully
});

test("createJob supports URLs without errors", async () => {
  const job = await createJob({
    sourceUrl: "https://www.youtube.com/watch?v=sample",
    clipCount: 3,
    provider: "groq",
    vertical: true,
    captions: true,
  });

  assert.ok(job.id);
  assert.equal(job.sourceKind, "url");
  assert.equal(job.provider, "groq");
  assert.equal(job.clipCount, 3);
});

test("createJob supports valid local file and rejects non-existent or disallowed files", async () => {
  // 1. Create a real temporary mp4 file
  const tmpDir = os.tmpdir();
  const validFile = path.join(tmpDir, `test_${Date.now()}.mp4`);
  fs.writeFileSync(validFile, Buffer.from("fake-mp4-data"));

  try {
    const job = await createJob({
      sourceUrl: validFile,
      clipCount: 2,
      provider: "local",
      vertical: true,
      captions: false,
    });

    assert.ok(job.id);
    assert.equal(job.sourceKind, "file");
    assert.equal(job.source, validFile);
  } finally {
    try {
      fs.unlinkSync(validFile);
    } catch {
      // ignore cleanup
    }
  }

  // 2. Reject non-existent file
  await assert.rejects(
    async () => {
      await createJob({
        sourceUrl: path.join(tmpDir, "non_existent_video_12345.mp4"),
        clipCount: 2,
        provider: "local",
        vertical: true,
        captions: false,
      });
    },
    { message: /not found at/ }
  );

  // 3. Reject disallowed extension (e.g. .exe / .sh)
  await assert.rejects(
    async () => {
      await createJob({
        sourceUrl: "C:\\Windows\\notepad.exe",
        clipCount: 2,
        provider: "local",
        vertical: true,
        captions: false,
      });
    },
    { message: /Invalid or prohibited file path/ }
  );
});

test("createJob rejects empty source", async () => {
  await assert.rejects(
    async () => {
      await createJob({
        sourceUrl: "",
        fileName: "",
        clipCount: 5,
        provider: "local",
        vertical: true,
        captions: true,
      });
    },
    { message: /Please specify a video URL or local file path/ }
  );
});

test("concurrent job creations serialize safely under mutex without race conditions", async () => {
  const promises = [1, 2, 3].map((n) =>
    createJob({
      sourceUrl: `https://example.com/video_${n}.mp4`,
      clipCount: 2,
      provider: "local",
      vertical: true,
      captions: false,
    })
  );

  const results = await Promise.all(promises);
  assert.equal(results.length, 3);
  const ids = new Set(results.map((r) => r.id));
  assert.equal(ids.size, 3);
});

test("patchClip updates clip kept and timestamps", async () => {
  const job = await createJob({
    sourceUrl: "https://sample.com/podcast.mp4",
    clipCount: 3,
    provider: "local",
    vertical: true,
    captions: true,
  });

  // Attach real clips for this job
  await setJobClips(job.id, [
    {
      id: "clip-1",
      title: "Hook clip",
      hook: "Listen",
      reason: "Energy",
      score: 85,
      start: 10,
      end: 40,
      text: "Transcript",
      kept: true,
    },
  ]);

  // Update via patchClip
  const updated = await patchClip(job.id, "clip-1", {
    kept: false,
    start: 50,
    end: 80,
  });

  const clip = updated.clips.find((c) => c.id === "clip-1");
  assert.ok(clip);
  assert.equal(clip.kept, false);
  assert.equal(clip.start, 50);
  assert.equal(clip.end, 80);
});

test("patchClip rejects invalid timestamp range (end <= start)", async () => {
  const job = await createJob({
    sourceUrl: "https://sample.com/lecture.mp4",
    clipCount: 2,
    provider: "local",
    vertical: true,
    captions: true,
  });

  await setJobClips(job.id, [
    {
      id: "clip-1",
      title: "Sample",
      hook: "H",
      reason: "R",
      score: 70,
      start: 10,
      end: 20,
      text: "T",
      kept: true,
    },
  ]);

  await assert.rejects(
    async () => {
      await patchClip(job.id, "clip-1", {
        start: 100,
        end: 90,
      });
    },
    { message: /End timestamp must be strictly greater than start timestamp/ }
  );
});

test("listJobs returns jobs sorted by createdAt descending", async () => {
  const jobs = await listJobs();
  assert.ok(Array.isArray(jobs));
  assert.ok(jobs.length > 0);
  for (let i = 0; i < jobs.length - 1; i++) {
    assert.ok(jobs[i].createdAt >= jobs[i + 1].createdAt);
  }
});

test("createJob stores chosen videoEncoder", async () => {
  const job = await createJob({
    sourceUrl: "https://example.com/nvenc.mp4",
    clipCount: 2,
    provider: "local",
    vertical: true,
    captions: true,
    videoEncoder: "h264_nvenc",
  });

  assert.equal(job.videoEncoder, "h264_nvenc");
  const fetched = await getJob(job.id);
  assert.equal(fetched.videoEncoder, "h264_nvenc");
});

test("deleteJob deletes job from store and returns true", async () => {
  const job = await createJob({
    sourceUrl: "https://example.com/delete-me.mp4",
    clipCount: 1,
    provider: "local",
    vertical: true,
    captions: false,
  });

  assert.ok(await getJob(job.id));
  const deleted = await deleteJob(job.id);
  assert.equal(deleted, true);
  assert.equal(await getJob(job.id), null);
});

