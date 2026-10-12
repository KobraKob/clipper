import { NextResponse } from "next/server";
import { scheduleClip } from "@/lib/store";
import type { Platform } from "@/lib/types";

interface RouteParams {
  params: Promise<{ id: string; clipId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { id, clipId } = await params;
    const body = (await req.json()) as { platform?: Platform | "both"; scheduledAtIso?: string };
    const platform = body.platform || "youtube";
    const scheduledAtIso = body.scheduledAtIso;

    if (!scheduledAtIso) {
      return NextResponse.json({ error: "scheduledAtIso timestamp is required." }, { status: 400 });
    }

    const job = await scheduleClip(id, clipId, platform, scheduledAtIso);
    return NextResponse.json(job);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to schedule clip" },
      { status: 500 },
    );
  }
}
