import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;
const ALLOWED_VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".flv"]);
const MAX_FILE_NAME_LENGTH = 180;

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
    // This route is intentionally stream-only. request.formData() buffers the whole
    // upload and can exhaust memory before an application-level size check runs.
    if (contentType !== "application/octet-stream") {
      return NextResponse.json({ error: "Upload a video as application/octet-stream." }, { status: 415 });
    }

    const contentLengthHeader = request.headers.get("content-length");
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : null;
    if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength < 0)) {
      return NextResponse.json({ error: "Invalid Content-Length header." }, { status: 400 });
    }
    if (contentLength !== null && contentLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Upload exceeds maximum request size of 4 GB." }, { status: 413 });
    }

    const fileName = decodeFileName(request.headers.get("x-file-name"));
    const extension = path.extname(fileName).toLowerCase();
    if (!ALLOWED_VIDEO_EXTS.has(extension)) {
      return NextResponse.json({ error: "Supported video formats: MP4, MOV, MKV, WEBM, AVI, M4V and FLV." }, { status: 415 });
    }
    if (!request.body) {
      return NextResponse.json({ error: "No video file provided." }, { status: 400 });
    }

    const cleanName = (fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-MAX_FILE_NAME_LENGTH) || "uploaded_video.mp4");
    const rootDir = await resolveRootDir();
    const configuredUploadsDir = path.resolve(rootDir, "workdir", "uploads");
    await fs.mkdir(configuredUploadsDir, { recursive: true });
    const uploadsDir = await fs.realpath(configuredUploadsDir);
    if (uploadsDir !== configuredUploadsDir) {
      throw new Error("Upload directory must not be a symbolic link.");
    }

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

    // Browser uploads remain streamed from the request to disk.
    const nodeStream = Readable.fromWeb(request.body as ReadableStream<Uint8Array>);
    await pipeline(nodeStream, limiter, createWriteStream(targetPath, { flags: "wx", mode: 0o600 }));

    if (totalBytes === 0) throw new Error("The selected video file is empty.");

    // Check container bytes after streaming to disk. A user-controlled extension
    // is not a trustworthy content-type signal.
    const handle = await fs.open(targetPath, "r");
    try {
      const header = Buffer.alloc(12);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      const signature = header.subarray(0, bytesRead);
      const validContainer =
        ((extension === ".mp4" || extension === ".m4v" || extension === ".mov") &&
          signature.length >= 8 && signature.toString("ascii", 4, 8) === "ftyp") ||
        ((extension === ".mkv" || extension === ".webm") &&
          signature.length >= 4 && signature[0] === 0x1a && signature[1] === 0x45 && signature[2] === 0xdf && signature[3] === 0xa3) ||
        (extension === ".avi" &&
          signature.length >= 12 && signature.toString("ascii", 0, 4) === "RIFF" && signature.toString("ascii", 8, 12) === "AVI ") ||
        (extension === ".flv" &&
          signature.length >= 3 && signature.toString("ascii", 0, 3) === "FLV");
      if (!validContainer) throw new Error("File contents do not match a supported video container.");
    } finally {
      await handle.close();
    }

    return NextResponse.json({
      path: targetPath,
      fileName: targetFileName,
      originalName: fileName.slice(0, MAX_FILE_NAME_LENGTH),
      size: totalBytes,
    });
  } catch (error) {
    if (targetPath) await fs.unlink(targetPath).catch(() => undefined);
    const message = error instanceof Error ? error.message : "Failed to upload video.";
    const status = /maximum (request|allowed upload) size|exceeds maximum/i.test(message)
      ? 413
      : /contents do not match/i.test(message)
        ? 415
        : /empty|file name|content-length/i.test(message)
          ? 400
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
