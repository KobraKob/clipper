import { NextResponse } from "next/server";
import { selectClipTitleVariant } from "@/lib/store";

interface RouteParams {
  params: Promise<{ id: string; clipId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { id, clipId } = await params;
    const body = (await req.json()) as { variantId?: string };
    if (!body.variantId) {
      return NextResponse.json({ error: "variantId is required." }, { status: 400 });
    }

    const job = await selectClipTitleVariant(id, clipId, body.variantId);
    return NextResponse.json(job);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to select title variant" },
      { status: 500 },
    );
  }
}
