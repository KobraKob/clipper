import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    ok: true,
    product: "clipper-studio",
    pipeline: ["ingest", "transcribe", "candidates", "score", "cut", "reframe", "captions", "export"],
  });
}
