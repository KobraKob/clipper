import { NextResponse } from "next/server";
import { resetYouTubeToken } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await resetYouTubeToken();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reset token.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
