import { NextResponse } from "next/server";
import { getJobStatus } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const status = await getJobStatus(id);
  if (!status) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-store" },
  });
}
