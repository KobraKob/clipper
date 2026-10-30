import { createReadStream, promises as fs } from "fs";
import { NextResponse } from "next/server";
import { getClipCoverFile, getClipVideoFile, patchClip } from "@/lib/store";

export const dynamic = "force-dynamic";

function createSafeVideoWebStream(
  filePath: string,
  start: number,
  end: number,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const nodeStream = createReadStream(filePath, { start, end });

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let isDone = false;

      const cleanup = () => {
        if (!isDone) {
          isDone = true;
          try {
            nodeStream.destroy();
          } catch {
            // Ignore destruction errors
          }
        }
      };

      nodeStream.on("data", (chunk: Buffer | string) => {
        if (isDone) return;
        try {
          if (controller.desiredSize === null) {
            cleanup();
            return;
          }
          const uint8 =
            typeof chunk === "string"
              ? Buffer.from(chunk)
              : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
          controller.enqueue(uint8);
        } catch {
          // Client disconnected or stream aborted
          cleanup();
        }
      });

      nodeStream.on("end", () => {
        if (isDone) return;
        isDone = true;
        try {
          controller.close();
        } catch {
          // Controller might already be closed by consumer
        }
      });

      nodeStream.on("error", (err) => {
        if (isDone) return;
        isDone = true;
        try {
          controller.error(err);
        } catch {
          // Controller might already be closed
        }
      });

      nodeStream.on("close", () => {
        isDone = true;
      });

      if (signal) {
        if (signal.aborted) {
          cleanup();
        } else {
          signal.addEventListener("abort", cleanup, { once: true });
        }
      }
    },
    cancel() {
      try {
        nodeStream.destroy();
      } catch {
        // Ignore destruction errors on cancel
      }
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; clipId: string }> },
) {
  const { id, clipId } = await params;
  const url = new URL(request.url);
  const wantsCover = url.searchParams.get("cover") === "1";

  if (wantsCover) {
    const coverPath = await getClipCoverFile(id, clipId);
    if (!coverPath) {
      return NextResponse.json(
        { error: "Cover frame for this clip has not been extracted yet or does not exist." },
        { status: 404 },
      );
    }
    try {
      const buffer = await fs.readFile(coverPath);
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": String(buffer.length),
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to read cover image.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const filePath = await getClipVideoFile(id, clipId);

  if (!filePath) {
    return NextResponse.json(
      { error: "Video file for this clip has not been exported yet or does not exist." },
      { status: 404 },
    );
  }

  try {
    const { size } = await fs.stat(filePath);
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") || "");
    let start = 0;
    let end = size - 1;
    let status = 200;
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), size - 1);
      } else {
        start = Math.max(0, size - Number(range[2])); // suffix range
      }
      if (start > end || start >= size) {
        return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      status = 206;
    }

    // Stream from disk with safe abort & client-disconnect handling
    const body = createSafeVideoWebStream(filePath, start, end, request.signal);
    const headers: Record<string, string> = {
      "Content-Type": "video/mp4",
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename="${clipId}.mp4"`,
    };
    if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    return new NextResponse(body, { status, headers });
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
      title?: string;
      description?: string;
      caption?: string;
      hashtags?: string[];
    };
    const job = await patchClip(id, clipId, body);
    return NextResponse.json(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update clip.";
    const status = message === "Job not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
