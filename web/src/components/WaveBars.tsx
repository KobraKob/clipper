import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

const BAR_HEIGHTS = [10, 22, 14, 28, 12, 24, 18, 26, 12, 20, 14, 22];

export function WaveBars({ active = false, label }: { active?: boolean; label?: string }) {
  return (
    <HStack gap={2} align="center">
      <svg
        viewBox="0 0 96 32"
        className="h-7 w-20 shrink-0 text-accent"
        aria-hidden="true"
      >
        {BAR_HEIGHTS.map((height, idx) => {
          const y = Math.round((32 - height) / 2);
          return (
            <rect
              key={idx}
              x={idx * 8 + 1}
              y={y}
              width="4"
              height={height}
              rx="2"
              fill="currentColor"
              opacity={active ? 0.95 : 0.45}
              className={active ? "animate-pulse motion-reduce:animate-none" : undefined}
            />
          );
        })}
      </svg>
      {label ? (
        <Text type="code" color="secondary">
          {label}
        </Text>
      ) : null}
    </HStack>
  );
}
