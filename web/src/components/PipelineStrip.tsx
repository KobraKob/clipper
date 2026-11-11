import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Step, Stepper } from "@astryxdesign/core/Stepper";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { PIPELINE_STAGES, type JobStatus, type StageId } from "@/lib/types";

type PipelineStripProps = {
  stageIndex: number;
  stageId: StageId | "done";
  status: JobStatus;
  progress?: number;
  progressMessage?: string;
};

export function PipelineStrip({
  stageIndex,
  stageId,
  status,
  progress = 0,
  progressMessage,
}: PipelineStripProps) {
  const isDone = status === "done";
  const isError = status === "error";
  const clampedStep = isDone
    ? PIPELINE_STAGES.length
    : Math.max(0, Math.min(PIPELINE_STAGES.length - 1, stageIndex));

  const pct = isDone
    ? 100
    : Math.max(
        2,
        Math.min(
          99,
          Math.round(
            progress > 0
              ? progress * 100
              : ((clampedStep + 0.5) / PIPELINE_STAGES.length) * 100,
          ),
        ),
      );

  const currentStage = PIPELINE_STAGES[Math.min(clampedStep, PIPELINE_STAGES.length - 1)];
  const stripLabel = isDone
    ? "PIPELINE COMPLETE"
    : isError
      ? `HALTED AT ${currentStage.label.toUpperCase()}`
      : `STAGE ${clampedStep + 1} OF ${PIPELINE_STAGES.length} · ${currentStage.label.toUpperCase()}`;

  return (
    <Card padding={5} variant="default">
      <VStack gap={4}>
        <HStack justify="between" align="center" wrap="wrap" gap={2}>
          <HStack gap={2} align="center">
            <StatusDot
              variant={isDone ? "success" : isError ? "error" : "warning"}
              isPulsing={!isDone && !isError}
              label={stripLabel}
            />
            <Text type="label">{stripLabel}</Text>
          </HStack>

          <HStack gap={2} align="center">
            {progressMessage ? (
              <Text type="supporting" color="secondary">
                {progressMessage}
              </Text>
            ) : null}
            <Badge
              label={`${pct}%`}
              variant={isDone ? "success" : isError ? "error" : "info"}
            />
          </HStack>
        </HStack>

        <ProgressBar
          label="Pipeline progress"
          isLabelHidden
          value={pct}
          max={100}
          variant={isDone ? "success" : isError ? "error" : "accent"}
        />

        <Stepper
          activeStep={clampedStep}
          orientation="horizontal"
          density="compact"
          indicatorPosition="on-track"
          horizontalOptions={{ minimumStepWidth: 88, collapsedVariant: "withLabel" }}
          label="Pipeline stages"
        >
          {PIPELINE_STAGES.map((stage, idx) => {
            const stepStatus =
              isError && stage.id === stageId
                ? "error"
                : isDone || idx < clampedStep
                  ? "success"
                  : idx === clampedStep
                    ? "accent"
                    : undefined;

            return (
              <Step
                key={stage.id}
                step={idx}
                label={stage.label}
                status={stepStatus}
              />
            );
          })}
        </Stepper>
      </VStack>
    </Card>
  );
}
