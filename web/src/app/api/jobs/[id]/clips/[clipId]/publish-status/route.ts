import { NextResponse } from "next/server";
import { getClipPublishStatus } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; clipId: string }> },
) {
  const { id, clipId } = await params;
  try {
    const snapshot = await getClipPublishStatus(id, clipId);
    if (!snapshot) {
      return NextResponse.json(
        { error: "Clip not found." },
        { status: 404 },
      );
    }
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Could not load publish status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
