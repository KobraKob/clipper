import { NextResponse } from "next/server";
import { getJob, getJobLogs } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const logs = await getJobLogs(id, 120);
  return NextResponse.json({
    id,
    status: job.status,
    stageId: job.stageId,
    progress: job.progress,
    progressMessage: job.progressMessage,
    error: job.error,
    logs,
  });
}
