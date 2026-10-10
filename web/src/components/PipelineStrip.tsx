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
    <section className="border-4 border-court bg-white stamp-sm">
      <div className="flex items-center justify-between border-b-4 border-court bg-volt px-3 py-2">
        <p className="display text-2xl">Pipeline</p>
        <p className="text-sm font-semibold">{Math.round(progress * 100)}%</p>
      </div>
      <ol className="grid grid-cols-2 md:grid-cols-4">
        {PIPELINE_STAGES.map((stage, index) => {
          const done = index < active;
          const current = index === active;
          return (
            <li
              key={stage.id}
              className={`border-court p-3 md:border-r-4 md:last:border-r-0 ${
                index < 4 ? "border-b-4 md:[&:nth-child(4)]:border-r-0" : ""
              } ${done ? "bg-ice text-white" : current ? "bg-punch text-white" : "bg-white"}`}
            >
              <p className="text-sm font-semibold">{stage.label}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
