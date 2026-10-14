import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB file cap
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024; // Allow up to 1 MiB for multipart headers.

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

export async function POST(request: Request) {
  let targetPath: string | undefined;
  try {
    // Reject oversized requests before parsing multipart data. The file-stream
    // limiter below remains necessary because Content-Length can be absent or false.
    const contentLength = Number(request.headers.get("content-length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES
    ) {
      return NextResponse.json(
        { error: "Upload exceeds the maximum allowed file size of 4 GB." },
        { status: 413 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string" || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No video file provided." }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "File exceeds maximum allowed upload size of 4 GB." },
        { status: 413 },
      );
    }

    const fileName = (file as File).name || "uploaded_video.mp4";
    const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const rootDir = await resolveRootDir();
    const uploadsDir = path.join(rootDir, "workdir", "uploads");
    await fs.mkdir(uploadsDir, { recursive: true });

    const targetFileName = `${Date.now()}_${cleanName}`;
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

    const webStream = file.stream();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeStream = Readable.fromWeb(webStream as any);
    const writeStream = createWriteStream(targetPath, { flags: "wx" });
    await pipeline(nodeStream, limiter, writeStream);

    return NextResponse.json({
      path: targetPath,
      fileName: targetFileName,
      originalName: fileName,
      size: totalBytes,
    });
  } catch (error) {
    if (targetPath) {
      try {
        await fs.unlink(targetPath);
      } catch {
        // The file may not have been created, or the stream may already have removed it.
      }
    }
    const message = error instanceof Error ? error.message : "Failed to upload video.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
