import { NextResponse } from "next/server";
import { createJob, listJobs } from "@/lib/store";
import type { CreateJobInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const jobs = await listJobs();
  return NextResponse.json(jobs);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateJobInput;
    const job = await createJob(body);
    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start a cut.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
