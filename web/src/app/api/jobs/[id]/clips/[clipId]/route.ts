import { promises as fs } from "fs";
import { NextResponse } from "next/server";
import { getClipVideoFile, patchClip } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; clipId: string }> },
) {
  const { id, clipId } = await params;
  const filePath = await getClipVideoFile(id, clipId);

  if (!filePath) {
    return NextResponse.json(
      { error: "Video file for this clip has not been exported yet or does not exist." },
      { status: 404 },
    );
  }

  try {
    const fileBuffer = await fs.readFile(filePath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(fileBuffer.length),
        "Content-Disposition": `inline; filename="${clipId}.mp4"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read video file.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; clipId: string }> },
) {
  const { id, clipId } = await params;
  try {
    const body = (await request.json()) as {
      kept?: boolean;
      start?: number;
      end?: number;
    };
    const job = await patchClip(id, clipId, body);
    return NextResponse.json(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update clip.";
    const status = message === "Job not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
