import { NextResponse } from "next/server";
import { selectClipThumbnailOption } from "@/lib/store";

interface RouteParams {
  params: Promise<{ id: string; clipId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { id, clipId } = await params;
    const body = (await req.json()) as { optionId?: string };
    if (!body.optionId) {
      return NextResponse.json({ error: "optionId is required." }, { status: 400 });
    }

    const job = await selectClipThumbnailOption(id, clipId, body.optionId);
    return NextResponse.json(job);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to select thumbnail option" },
      { status: 400 },
    );
  }
}
