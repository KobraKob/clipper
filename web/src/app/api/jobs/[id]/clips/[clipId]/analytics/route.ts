import { NextResponse } from "next/server";
import { fetchClipAnalytics } from "@/lib/store";

interface RouteParams {
  params: Promise<{ id: string; clipId: string }>;
}

export async function POST(_req: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const job = await fetchClipAnalytics(id);
    return NextResponse.json(job);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch clip analytics" },
      { status: 500 },
    );
  }
}
