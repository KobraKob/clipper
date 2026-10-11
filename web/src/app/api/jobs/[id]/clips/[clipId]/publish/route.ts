import { NextResponse } from "next/server";
import { publishClip } from "@/lib/store";
import type { Platform } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; clipId: string }> },
) {
  const { id, clipId } = await params;
  try {
    const body = (await request.json()) as { platforms?: Platform[] };
    const job = await publishClip(id, clipId, body.platforms ?? []);
    return NextResponse.json(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publish failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
