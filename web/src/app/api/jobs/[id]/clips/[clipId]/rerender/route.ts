import { NextResponse } from "next/server";
import { rerenderClip } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; clipId: string }> },
) {
  const { id, clipId } = await params;
  try {
    const body = (await request.json()) as { start: number; end: number };
    if (typeof body.start !== "number" || typeof body.end !== "number") {
      return NextResponse.json({ error: "Missing valid start and end timestamps." }, { status: 400 });
    }
    const job = await rerenderClip(id, clipId, body.start, body.end);
    return NextResponse.json(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Re-rendering clip failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
