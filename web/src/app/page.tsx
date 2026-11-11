import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Divider } from "@astryxdesign/core/Divider";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Section } from "@astryxdesign/core/Section";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { HomeStudioPulse } from "@/components/HomeStudioPulse";
import { PhoneStack } from "@/components/PhoneStack";
import {
  ArrowRightGlyph,
  FilmGlyph,
  ScissorsGlyph,
  SparklesGlyph,
} from "@/components/StudioIcons";
import { PIPELINE_STAGES } from "@/lib/types";

const STAGE_DESCRIPTIONS: Record<string, string> = {
  ingest: "Stream or import raw footage locally without compression loss.",
  transcribe: "Whisper speech-to-text generating word-level timestamps.",
  candidates: "Sliding window segmentation isolating high-density narrative arcs.",
  score: "Semantic hook scoring and attention retention ranking.",
  cut: "Lossless frame-accurate trimming across selected timestamps.",
  reframe: "Active-speaker intelligent framing for 9:16 vertical viewports.",
  captions: "Styled kinetic subtitles with animated karaoke word pop.",
  export: "Multi-platform export ready for TikTok, Shorts & Reels.",
};

const STATS = [
  { value: "9:16", label: "Smart Vertical Reframe" },
  { value: "< 60s", label: "Hook Discovery" },
  { value: "100%", label: "Local-First Privacy" },
  { value: "0", label: "Watermarks or Limits" },
];

const WORKFLOWS = [
  {
    href: "/new",
    eyebrow: "01 · CREATE",
    title: "New Cut Studio",
    description:
      "Configure source URL or video upload, speaker layout, kinetic caption styles, audio mastering, and GPU encoder.",
    cta: "Launch New Cut",
    icon: ScissorsGlyph,
  },
  {
    href: "/library",
    eyebrow: "02 · MANAGE",
    title: "Media Library & Batch",
    description:
      "Inspect completed projects, jump into the frame-accurate Cut Inspector, or batch-import an entire folder of videos.",
    cta: "Open Library",
    icon: FilmGlyph,
  },
  {
    href: "/calendar",
    eyebrow: "03 · DISTRIBUTE",
    title: "Publishing Calendar",
    description:
      "Schedule kept shorts to YouTube and Instagram, inspect dispatch queues, and retry failed uploads.",
    cta: "View Calendar",
    icon: "calendar" as const,
  },
];

export default function Home() {
  return (
    <VStack gap={8} paddingBlock={8} paddingInline={4} maxWidth={1360} width="100%" className="mx-auto sm:px-6 lg:px-8">
      {/* Hero Section */}
      <Section variant="transparent" padding={0} aria-labelledby="home-title">
        <Grid columns={{ minWidth: 320, max: 2 }} gap={8} align="center">
          <VStack gap={5}>
            <HStack gap={2} vAlign="center">
              <Badge
                variant="purple"
                icon={<Icon icon={SparklesGlyph} size="xsm" />}
                label="Next-Gen Vertical Cut Room"
              />
              <StatusDot variant="success" isPulsing label="Engine ready" />
              <Text type="supporting" size="2xs">
                Local-first processing
              </Text>
            </HStack>

            <Heading level={1} type="display-1" id="home-title">
              Find the moment.{" "}
              <Text as="span" type="inherit" color="accent">
                Make the cut.
              </Text>
            </Heading>

            <VStack maxWidth={600}>
              <Text type="large" color="secondary">
                Transform hours of podcasts, streams, and interviews into high-converting vertical shorts.
                AI-powered hook discovery, dynamic speaker tracking, animated captions, and direct multi-platform scheduling.
              </Text>
            </VStack>

            <HStack gap={3} wrap="wrap" paddingBlockStart={2}>
              <Button
                href="/new"
                label="Start New Cut"
                variant="primary"
                size="lg"
                elevation="med"
                icon={<Icon icon={ScissorsGlyph} size="sm" />}
              />

              <Button
                href="/library"
                label="Open Library"
                variant="secondary"
                size="lg"
                endContent={<Icon icon={ArrowRightGlyph} size="sm" color="secondary" />}
              />
            </HStack>

            <Divider />

            <Grid columns={{ minWidth: 130, max: 4 }} gap={4}>
              {STATS.map((stat) => (
                <VStack key={stat.label} gap={0.5}>
                  <Text type="display-3" weight="bold" hasTabularNumbers>
                    {stat.value}
                  </Text>
                  <Text type="supporting" size="2xs">
                    {stat.label}
                  </Text>
                </VStack>
              ))}
            </Grid>
          </VStack>

          <Card padding={4} elevation="med" className="rounded-xl border border-border-emphasized">
            <VStack gap={3}>
              <HStack hAlign="between" vAlign="center" paddingBlockEnd={2} className="border-b border-border">
                <HStack gap={2} vAlign="center">
                  <StatusDot variant="accent" isPulsing label="Interactive preview active" />
                  <Text type="label" size="2xs">
                    Interactive Vertical Preview
                  </Text>
                </HStack>
                <Text type="code" size="2xs" color="accent">
                  1080 × 1920
                </Text>
              </HStack>

              <PhoneStack />

              <Card variant="muted" padding={3}>
                <HStack hAlign="between" vAlign="center">
                  <Text type="supporting" size="2xs">
                    Speaker Framing
                  </Text>
                  <HStack gap={1.5} vAlign="center">
                    <StatusDot variant="success" label="Auto active" />
                    <Text size="2xs" weight="semibold" color="primary">
                      Auto Active
                    </Text>
                  </HStack>
                </HStack>
              </Card>
            </VStack>
          </Card>
        </Grid>
      </Section>

      {/* Distinct Workflow Portals */}
      <Section variant="transparent" padding={0} aria-labelledby="workflows-title">
        <VStack gap={4}>
          <VStack gap={1}>
            <Text type="label" size="2xs" color="accent" weight="bold">
              DEDICATED WORKSPACES
            </Text>
            <Heading level={2} id="workflows-title">
              Choose Your Room
            </Heading>
          </VStack>

          <Grid columns={{ minWidth: 280, max: 3 }} gap={4}>
            {WORKFLOWS.map((flow) => (
              <ClickableCard
                key={flow.href}
                href={flow.href}
                label={`${flow.title}: ${flow.cta}`}
                padding={5}
                elevation="low"
              >
                <VStack gap={3} height="100%" vAlign="between">
                  <VStack gap={2}>
                    <HStack hAlign="between" vAlign="center">
                      <Text type="code" size="2xs" color="accent" weight="semibold">
                        {flow.eyebrow}
                      </Text>
                      <Icon icon={flow.icon} size="md" color="accent" />
                    </HStack>
                    <Heading level={3}>{flow.title}</Heading>
                    <Text type="supporting" size="sm">
                      {flow.description}
                    </Text>
                  </VStack>
                  <HStack gap={1.5} vAlign="center" paddingBlockStart={2}>
                    <Text size="sm" weight="semibold" color="accent">
                      {flow.cta}
                    </Text>
                    <Icon icon={ArrowRightGlyph} size="xsm" color="accent" />
                  </HStack>
                </VStack>
              </ClickableCard>
            ))}
          </Grid>
        </VStack>
      </Section>

      {/* Live Workspace Pulse */}
      <HomeStudioPulse />

      {/* 8-Stage Pipeline Overview */}
      <Section id="pipeline" variant="section" padding={5} className="rounded-lg border border-border" aria-labelledby="pipeline-title">
        <VStack gap={5}>
          <VStack gap={1.5} maxWidth={680}>
            <Text type="label" size="2xs" color="accent" weight="bold">
              AUTONOMOUS ARCHITECTURE
            </Text>
            <Heading level={2} id="pipeline-title">
              How the Cutting Engine Works
            </Heading>
            <Text type="supporting" size="base">
              Every video passes through eight discrete, deterministic processing stages to ensure broadcast-grade vertical exports.
            </Text>
          </VStack>

          <Grid columns={{ minWidth: 240, max: 4 }} gap={3}>
            {PIPELINE_STAGES.map((stage, idx) => (
              <Card key={stage.id} variant="muted" padding={4}>
                <VStack gap={2}>
                  <HStack hAlign="between" vAlign="center">
                    <Text type="code" size="2xs" color="accent" weight="bold">
                      {String(idx + 1).padStart(2, "0")}
                    </Text>
                    <StatusDot variant="neutral" label={`Stage ${idx + 1}: ${stage.label}`} />
                  </HStack>
                  <Heading level={3}>{stage.label}</Heading>
                  <Text type="supporting" size="2xs">
                    {STAGE_DESCRIPTIONS[stage.id] || "Automated processing stage."}
                  </Text>
                </VStack>
              </Card>
            ))}
          </Grid>
        </VStack>
      </Section>
    </VStack>
  );
}
