import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_SOUNDTRACK_BYTES = 100 * 1024 * 1024;
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
    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/octet-stream") {
      return NextResponse.json({ error: "Upload soundtrack as application/octet-stream." }, { status: 415 });
    }
    const lengthHeader = request.headers.get("content-length");
    const contentLength = lengthHeader ? Number(lengthHeader) : null;
    if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength < 0)) {
      return NextResponse.json({ error: "Invalid Content-Length header." }, { status: 400 });
    }
    if (contentLength !== null && contentLength > MAX_SOUNDTRACK_BYTES) {
      return NextResponse.json({ error: "Soundtrack exceeds the 100 MB upload limit." }, { status: 413 });
    }
    const originalName = decodeFileName(request.headers.get("x-file-name"));
    if (!request.body) return NextResponse.json({ error: "No soundtrack file provided." }, { status: 400 });
    const bodyStream = request.body;
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
    const resolvedDir = await fs.realpath(soundtrackDir);
    if (resolvedDir !== path.resolve(soundtrackDir)) throw new Error("Soundtrack directory must not be a symbolic link.");

    const uniquePrefix = `${Date.now()}_${crypto.randomUUID()}`;
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
    await pipeline(nodeStream, limiter, createWriteStream(targetPath, { flags: "wx", mode: 0o600 }));

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
