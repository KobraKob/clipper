import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB cap

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
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string" || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No video file provided." }, { status: 400 });
    }

    const fileName = (file as File).name || "uploaded_video.mp4";
    const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const rootDir = await resolveRootDir();
    const uploadsDir = path.join(rootDir, "workdir", "uploads");
    await fs.mkdir(uploadsDir, { recursive: true });

    const targetFileName = `${Date.now()}_${cleanName}`;
    const targetPath = path.join(uploadsDir, targetFileName);

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
    const writeStream = createWriteStream(targetPath);
    await pipeline(nodeStream, limiter, writeStream);

    return NextResponse.json({
      path: targetPath,
      fileName: targetFileName,
      originalName: fileName,
      size: totalBytes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to upload video.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
