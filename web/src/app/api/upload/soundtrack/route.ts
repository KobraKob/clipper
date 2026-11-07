import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_SOUNDTRACK_BYTES = 100 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD = 1024 * 1024;
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

function decodeFileName(value: string | null): string {
  if (!value) return "soundtrack.mp3";
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("Invalid soundtrack file name.");
  }
}

export async function POST(request: Request) {
  let targetPath: string | undefined;
  try {
    const isRawUpload =
      request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ===
      "application/octet-stream";
    const contentLength = Number(request.headers.get("content-length"));
    const requestLimit = isRawUpload
      ? MAX_SOUNDTRACK_BYTES
      : MAX_SOUNDTRACK_BYTES + MAX_MULTIPART_OVERHEAD;

    if (Number.isFinite(contentLength) && contentLength > requestLimit) {
      return NextResponse.json({ error: "Soundtrack exceeds the 100 MB upload limit." }, { status: 413 });
    }

    let originalName: string;
    let bodyStream: ReadableStream<Uint8Array>;
    if (isRawUpload) {
      originalName = decodeFileName(request.headers.get("x-file-name"));
      if (!request.body) {
        return NextResponse.json({ error: "No soundtrack file provided." }, { status: 400 });
      }
      bodyStream = request.body;
    } else {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string" || !(file instanceof Blob)) {
        return NextResponse.json({ error: "No soundtrack file provided." }, { status: 400 });
      }
      originalName = (file as File).name || "soundtrack.mp3";
      if (file.size === 0) {
        return NextResponse.json({ error: "The selected soundtrack is empty." }, { status: 400 });
      }
      if (file.size > MAX_SOUNDTRACK_BYTES) {
        return NextResponse.json({ error: "Soundtrack exceeds the 100 MB upload limit." }, { status: 413 });
      }
      bodyStream = file.stream();
    }

    const extension = path.extname(originalName).toLowerCase();
    if (!ALLOWED_EXTS.has(extension)) {
      return NextResponse.json(
        { error: "Supported audio formats: MP3, WAV, M4A, AAC, OGG and FLAC." },
        { status: 415 },
      );
    }

    const cleanName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_") || "soundtrack.mp3";
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

    // Stream raw browser uploads to disk with a bounded byte counter.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeStream = Readable.fromWeb(bodyStream as any);
    await pipeline(nodeStream, limiter, createWriteStream(targetPath, { flags: "wx" }));

    if (totalBytes === 0) {
      throw new Error("The selected soundtrack is empty.");
    }

    return NextResponse.json({
      path: targetPath,
      fileName: targetFileName,
      originalName,
      size: totalBytes,
    });
  } catch (error) {
    if (targetPath) await fs.unlink(targetPath).catch(() => undefined);
    const message = error instanceof Error ? error.message : "Failed to upload soundtrack.";
    const status = /100 MB upload limit/i.test(message)
      ? 413
      : /empty|file name/i.test(message)
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
