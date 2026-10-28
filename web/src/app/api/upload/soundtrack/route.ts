import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_SOUNDTRACK_BYTES = 100 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_SOUNDTRACK_BYTES + 1024 * 1024;
const ALLOWED_EXTS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);

async function resolveRootDir(): Promise<string> {
  const current = process.cwd();
  try {
    const stat = await fs.stat(path.join(current, "clipper"));
    if (stat.isDirectory()) return current;
  } catch {
    // Next.js may be running from web/.
  }
  return path.resolve(current, "..");
}

export async function POST(request: Request) {
  let targetPath: string | undefined;
  try {
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "Soundtrack exceeds the 100 MB upload limit." }, { status: 413 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string" || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No soundtrack file provided." }, { status: 400 });
    }

    const originalName = (file as File).name || "soundtrack.mp3";
    const extension = path.extname(originalName).toLowerCase();
    if (!ALLOWED_EXTS.has(extension)) {
      return NextResponse.json(
        { error: "Supported audio formats: MP3, WAV, M4A, AAC, OGG and FLAC." },
        { status: 415 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "The selected soundtrack is empty." }, { status: 400 });
    }
    if (file.size > MAX_SOUNDTRACK_BYTES) {
      return NextResponse.json({ error: "Soundtrack exceeds the 100 MB upload limit." }, { status: 413 });
    }

    const cleanName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const rootDir = await resolveRootDir();
    const soundtrackDir = path.join(rootDir, "workdir", "soundtracks");
    await fs.mkdir(soundtrackDir, { recursive: true });

    const uniquePrefix = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const targetFileName = `${uniquePrefix}_${cleanName}`;
    targetPath = path.join(soundtrackDir, targetFileName);

    let totalBytes = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        totalBytes += chunk.length;
        if (totalBytes > MAX_SOUNDTRACK_BYTES) {
          callback(new Error("Soundtrack exceeds the 100 MB upload limit."));
        } else {
          callback(null, chunk);
        }
      },
    });

    // The Web File stream is copied to disk with a size guard and exclusive create.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeStream = Readable.fromWeb(file.stream() as any);
    await pipeline(nodeStream, limiter, createWriteStream(targetPath, { flags: "wx" }));

    return NextResponse.json({
      path: targetPath,
      fileName: targetFileName,
      originalName,
      size: totalBytes,
    });
  } catch (error) {
    if (targetPath) await fs.unlink(targetPath).catch(() => undefined);
    const message = error instanceof Error ? error.message : "Failed to upload soundtrack.";
    const status = /100 MB upload limit/i.test(message) ? 413 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
