import test from "node:test";
import assert from "node:assert/strict";
import { createJob, getJob, listJobs, patchClip } from "../src/lib/store.ts";
import { formatTimecode, hydrateJob, buildPreviewClips } from "../src/lib/pipeline.ts";

test("formatTimecode formats seconds correctly", () => {
  assert.equal(formatTimecode(0), "0:00");
  assert.equal(formatTimecode(59), "0:59");
  assert.equal(formatTimecode(60), "1:00");
  assert.equal(formatTimecode(125), "2:05");
  assert.equal(formatTimecode(3600), "60:00");
});

test("buildPreviewClips generates requested count with valid bounds", () => {
  const clips = buildPreviewClips("test-source", 4);
  assert.equal(clips.length, 4);
  for (const c of clips) {
    assert.ok(c.id.startsWith("clip-"));
    assert.ok(c.title.length > 0);
    assert.ok(c.hook.length > 0);
    assert.ok(c.score > 0);
    assert.ok(c.end > c.start);
    assert.equal(c.kept, true);
  }
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

test("createJob supports local file paths without rejection", async () => {
  const job = await createJob({
    sourceUrl: "C:\\videos\\interview.mp4",
    clipCount: 4,
    provider: "local",
    vertical: true,
    captions: false,
  });

  assert.ok(job.id);
  assert.equal(job.sourceKind, "file");
  assert.equal(job.source, "C:\\videos\\interview.mp4");
  assert.equal(job.provider, "local");
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

test("patchClip updates clip kept and timestamps", async () => {
  const job = await createJob({
    sourceUrl: "https://sample.com/podcast.mp4",
    clipCount: 3,
    provider: "local",
    vertical: true,
    captions: true,
  });

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
