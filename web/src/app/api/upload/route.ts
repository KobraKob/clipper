import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB cap
const MAX_MULTIPART_OVERHEAD = 1024 * 1024;

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
    const isRawUpload =
      request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ===
      "application/octet-stream";
    const contentLength = Number(request.headers.get("content-length"));
    const requestLimit = isRawUpload
      ? MAX_UPLOAD_BYTES
      : MAX_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD;

    if (Number.isFinite(contentLength) && contentLength > requestLimit) {
      return NextResponse.json(
        { error: "Upload exceeds maximum request size of 4 GB." },
        { status: 413 },
      );
    }

    let fileName: string;
    let bodyStream: ReadableStream<Uint8Array>;
    if (isRawUpload) {
      fileName = decodeFileName(request.headers.get("x-file-name"));
      if (!request.body) {
        return NextResponse.json({ error: "No video file provided." }, { status: 400 });
      }
      bodyStream = request.body;
    } else {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string" || !(file instanceof Blob)) {
        return NextResponse.json({ error: "No video file provided." }, { status: 400 });
      }
      if (file.size === 0) {
        return NextResponse.json({ error: "The selected video file is empty." }, { status: 400 });
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          { error: "File exceeds maximum allowed upload size of 4 GB." },
          { status: 413 },
        );
      }
      fileName = (file as File).name || "uploaded_video.mp4";
      bodyStream = file.stream();
    }

    const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_") || "uploaded_video.mp4";
    const rootDir = await resolveRootDir();
    const uploadsDir = path.join(rootDir, "workdir", "uploads");
    await fs.mkdir(uploadsDir, { recursive: true });

    const targetFileName = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${cleanName}`;
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
    const writeStream = createWriteStream(targetPath, { flags: "wx" });
    await pipeline(nodeStream, limiter, writeStream);

    if (totalBytes === 0) {
      throw new Error("The selected video file is empty.");
    }

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
