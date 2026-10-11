import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(targetPath, buffer);

    return NextResponse.json({
      path: targetPath,
      fileName: targetFileName,
      originalName: fileName,
      size: buffer.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to upload video.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
