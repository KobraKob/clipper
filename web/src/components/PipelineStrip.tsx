import type { CSSProperties } from "react";
import { PIPELINE_STAGES, type StageId } from "@/lib/types";

type Props = {
  stageId: StageId | "done";
  progress: number;
  failed?: boolean;
  /** Drop the outer card when the strip already sits inside one. */
  bare?: boolean;
};

export function PipelineStrip({ stageId, progress, failed = false, bare = false }: Props) {
  const total = PIPELINE_STAGES.length;
  const found = stageId === "done" ? total : PIPELINE_STAGES.findIndex((s) => s.id === stageId);
  const active = found === -1 ? 0 : found;
  const finished = stageId === "done" && !failed;
  const pct = finished ? 100 : Math.round(Math.max(0, Math.min(1, progress)) * 100);

  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="display text-xl text-ink md:text-2xl">Pipeline</p>
        <p
          className={`font-mono text-sm font-bold tabular-nums ${
            failed ? "text-punch" : finished ? "text-ice" : "text-volt"
          }`}
        >
          {failed ? "Stopped" : finished ? "Complete" : `${pct}%`}
        </p>
      </div>

      <div
        role="progressbar"
        aria-label="Overall progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-inset"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${failed ? "bg-punch" : finished ? "bg-ice" : "bg-volt"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <ol
        className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-[repeat(var(--n),minmax(0,1fr))]"
        style={{ "--n": total } as CSSProperties}
      >
        {PIPELINE_STAGES.map((stage, index) => {
          const isDone = index < active || finished;
          const isCurrent = index === active && !finished;
          const isFailed = isCurrent && failed;

          const tone = isFailed
            ? "border-punch bg-punch/15 text-punch"
            : isCurrent
            ? "border-volt bg-volt/10 text-volt"
            : isDone
            ? "border-ice/30 bg-ice/10 text-ice"
            : "border-white/10 bg-panel-inset text-muted";

          const state = isFailed ? "Failed" : isCurrent ? "Running" : isDone ? "Done" : "Queued";

          return (
            <li
              key={stage.id}
              aria-current={isCurrent ? "step" : undefined}
              className={`flex flex-col gap-1.5 rounded-lg border p-3 ${tone}`}
            >
              <span className="flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-wider">
                <span className="opacity-70">{String(index + 1).padStart(2, "0")}</span>
                <span className="flex items-center gap-1.5">
                  {isCurrent && !failed ? (
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-current motion-safe:animate-ping" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
                    </span>
                  ) : null}
                  {state}
                </span>
              </span>
              <span className="text-xs font-semibold md:text-sm">{stage.label}</span>
            </li>
          );
        })}
      </ol>
    </>
  );

  if (bare) return <div>{body}</div>;

  return (
    <section aria-label="Pipeline" className="stamp-sm rounded-xl border border-white/15 bg-panel p-4 md:p-5">
      {body}
    </section>
  );
}