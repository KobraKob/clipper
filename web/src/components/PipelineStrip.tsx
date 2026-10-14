import { PIPELINE_STAGES, type StageId } from "@/lib/types";

export function PipelineStrip({
  stageId,
  progress,
}: {
  stageId: StageId | "done";
  progress: number;
}) {
  const active = stageId === "done" ? PIPELINE_STAGES.length : PIPELINE_STAGES.findIndex((s) => s.id === stageId);

  return (
    <section className="border border-white/15 bg-panel rounded-xl overflow-hidden stamp-sm">
      <div className="flex items-center justify-between border-b border-white/12 bg-panel-raised px-4 py-2.5 text-volt">
        <p className="display text-xl md:text-2xl">Pipeline</p>
        <p className="text-sm font-mono font-bold">{Math.round(progress * 100)}%</p>
      </div>
      <ol className="grid grid-cols-2 md:grid-cols-4">
        {PIPELINE_STAGES.map((stage, index) => {
          const done = index < active;
          const current = index === active;
          return (
            <li
              key={stage.id}
              className={`p-3 md:border-r border-white/10 ${
                index < 4 ? "border-b md:[&:nth-child(4)]:border-r-0" : ""
              } ${
                done
                  ? "bg-ice/15 text-ice font-semibold"
                  : current
                  ? "bg-punch text-white font-bold animate-pulse"
                  : "bg-panel text-muted"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono opacity-60">0{index + 1}</span>
                <p className="text-xs md:text-sm font-semibold">{stage.label}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
