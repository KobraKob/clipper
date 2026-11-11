import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB cap
const ALLOWED_VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".flv"]);

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

function decodeFileName(value: string | null): string {
  if (!value) return "uploaded_video.mp4";
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("Invalid upload file name.");
  }
}

export async function POST(request: Request) {
  let targetPath: string | undefined;
  try {
    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/octet-stream") {
      return NextResponse.json({ error: "Upload video as application/octet-stream." }, { status: 415 });
    }
    const lengthHeader = request.headers.get("content-length");
    const contentLength = lengthHeader ? Number(lengthHeader) : null;
    if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength < 0)) {
      return NextResponse.json({ error: "Invalid Content-Length header." }, { status: 400 });
    }
    if (contentLength !== null && contentLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Upload exceeds maximum request size of 4 GB." }, { status: 413 });
    }
    const fileName = decodeFileName(request.headers.get("x-file-name"));
    const extension = path.extname(fileName).toLowerCase();
    if (!ALLOWED_VIDEO_EXTS.has(extension)) {
      return NextResponse.json({ error: "Unsupported video file extension." }, { status: 415 });
    }
    if (!request.body) return NextResponse.json({ error: "No video file provided." }, { status: 400 });
    const bodyStream = request.body;
    const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180) || "uploaded_video.mp4";
    const rootDir = await resolveRootDir();
    const configuredUploadsDir = path.resolve(rootDir, "workdir", "uploads");
    await fs.mkdir(configuredUploadsDir, { recursive: true });
    const uploadsDir = await fs.realpath(configuredUploadsDir);
    if (uploadsDir !== configuredUploadsDir) throw new Error("Upload directory must not be a symbolic link.");

    const targetFileName = `${Date.now()}_${crypto.randomUUID()}_${cleanName}`;
    targetPath = path.join(uploadsDir, targetFileName);

    let totalBytes = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        totalBytes += chunk.length;
        if (totalBytes > MAX_UPLOAD_BYTES) {
          callback(new Error("File exceeds maximum allowed upload size of 4 GB."));
        } else {
          callback(null, chunk);
        }
      },
    });

    // Raw browser uploads stay streamed end-to-end; no full-file formData parse.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeStream = Readable.fromWeb(bodyStream as any);
    const writeStream = createWriteStream(targetPath, { flags: "wx", mode: 0o600 });
    await pipeline(nodeStream, limiter, writeStream);

    if (totalBytes === 0) throw new Error("The selected video file is empty.");

    const handle = await fs.open(/*turbopackIgnore: true*/ targetPath, "r");
    try {
      const header = Buffer.alloc(12);
      const { bytesRead } = await handle.read(header, 0, 12, 0);
      const sig = header.subarray(0, bytesRead);
      const valid =
        ([".mp4", ".m4v", ".mov"].includes(extension) && sig.length >= 8 && sig.toString("ascii", 4, 8) === "ftyp") ||
        ([".mkv", ".webm"].includes(extension) && sig.length >= 4 && sig[0] === 0x1a && sig[1] === 0x45 && sig[2] === 0xdf && sig[3] === 0xa3) ||
        (extension === ".avi" && sig.length >= 12 && sig.toString("ascii", 0, 4) === "RIFF" && sig.toString("ascii", 8, 12) === "AVI ") ||
        (extension === ".flv" && sig.length >= 3 && sig.toString("ascii", 0, 3) === "FLV");
      if (!valid) throw new Error("File contents do not match the selected video container.");
    } finally { await handle.close(); }

    return NextResponse.json({
      path: targetPath,
      fileName: targetFileName,
      originalName: fileName,
      size: totalBytes,
    });
  } catch (error) {
    if (targetPath) {
      await fs.unlink(targetPath).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : "Failed to upload video.";
    const status = /maximum (request|allowed upload) size|exceeds maximum/i.test(message)
      ? 413
      : /empty|file name/i.test(message)
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
