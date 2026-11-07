"use client";

import type { CSSProperties } from "react";
import { motion } from "motion/react";
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
        <p className="font-display text-xl text-white md:text-2xl tracking-tight">Pipeline Progress</p>
        <p
          className={`font-mono text-sm font-bold tabular-nums ${
            failed ? "text-rose-400" : finished ? "text-emerald-400" : "text-indigo-300"
          }`}
        >
          {failed ? "Halted" : finished ? "All Complete" : `${pct}%`}
        </p>
      </div>

      <div
        role="progressbar"
        aria-label="Overall progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mt-3 h-2 overflow-hidden rounded-full bg-slate-900 border border-white/[0.08]"
      >
        <motion.div
          className={`h-full rounded-full ${
            failed
              ? "bg-rose-500 shadow-sm shadow-rose-500/50"
              : finished
              ? "bg-gradient-to-r from-emerald-500 to-teal-400 shadow-sm shadow-emerald-500/50"
              : "bg-gradient-to-r from-indigo-500 via-indigo-400 to-cyan-400 shadow-sm shadow-indigo-500/50"
          }`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>

      <ol
        className="mt-4 grid grid-cols-2 gap-2 sm:gap-2.5 md:grid-cols-[repeat(var(--n),minmax(0,1fr))]"
        style={{ "--n": total } as CSSProperties}
      >
        {PIPELINE_STAGES.map((stage, index) => {
          const isDone = index < active || finished;
          const isCurrent = index === active && !finished;
          const isFailed = isCurrent && failed;

          const tone = isFailed
            ? "border-rose-500/60 bg-rose-500/10 text-rose-300 shadow-sm shadow-rose-500/10"
            : isCurrent
            ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-200 shadow-md shadow-indigo-500/20 ring-1 ring-indigo-500/30"
            : isDone
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            : "border-white/[0.06] bg-[#090b10] text-slate-500";

          const state = isFailed ? "Failed" : isCurrent ? "Active" : isDone ? "Done" : "Queued";

          return (
            <li
              key={stage.id}
              aria-current={isCurrent ? "step" : undefined}
              className={`flex flex-col gap-1.5 rounded-xl border p-3 transition-colors duration-200 ${tone}`}
            >
              <span className="flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-wider">
                <span className="opacity-70">{String(index + 1).padStart(2, "0")}</span>
                <span className="flex items-center gap-1.5">
                  {isCurrent && !failed ? (
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-cyan-400 animate-ping opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
                    </span>
                  ) : null}
                  {state}
                </span>
              </span>
              <span className="text-xs font-semibold md:text-sm text-slate-200 truncate">{stage.label}</span>
            </li>
          );
        })}
      </ol>
    </>
  );

  if (bare) return <div>{body}</div>;

  return (
    <section aria-label="Pipeline" className="rounded-2xl border border-white/[0.08] bg-[#0c0e15]/90 p-4 md:p-6 backdrop-blur-md">
      {body}
    </section>
  );
}
