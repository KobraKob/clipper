import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Kbd } from "@astryxdesign/core/Kbd";
import { Section } from "@astryxdesign/core/Section";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import type { Metadata } from "next";
import { CutForm } from "@/components/CutForm";
import { FilmGlyph, ScissorsGlyph } from "@/components/StudioIcons";

export const metadata: Metadata = {
  title: "New Cut — Chop Shop",
  description:
    "Configure framing, burned-in captions, audio mix, and AI ranking to start a new clip extraction run.",
};

export default function NewCutPage() {
  return (
    <VStack
      gap={8}
      paddingBlock={6}
      paddingBlockEnd={10}
      paddingInline={4}
      maxWidth={1360}
      width="100%"
      className="mx-auto sm:px-6 lg:px-8"
    >
      <Section variant="transparent" padding={0}>
        <VStack gap={4}>
          <Breadcrumbs>
            <BreadcrumbItem href="/">Overview</BreadcrumbItem>
            <BreadcrumbItem isCurrent>New cut</BreadcrumbItem>
          </Breadcrumbs>

          <HStack gap={4} justify="between" align="end" wrap="wrap">
            <VStack gap={2} maxWidth={680}>
              <HStack gap={2} align="center">
                <Icon icon={ScissorsGlyph} size="sm" color="accent" />
                <Text type="label" color="accent">
                  CLIP STUDIO LAUNCHER
                </Text>
              </HStack>
              <Heading level={1} type="display-2">
                Start a new cut
              </Heading>
              <Text type="large" color="secondary">
                Drop a long-form video or paste a link, dial in vertical reframing and burned-in captions, and launch an autonomous pipeline run.
              </Text>
            </VStack>

            <HStack gap={3} align="center" wrap="wrap">
              <HStack gap={1.5} align="center">
                <Kbd keys="mod+enter" />
                <Text type="supporting" color="secondary">
                  to launch
                </Text>
              </HStack>
              <Button
                label="Batch upload"
                href="/library#batch"
                variant="secondary"
                size="sm"
                icon={<Icon icon={FilmGlyph} />}
              />
              <Button
                label="Open library"
                href="/library"
                variant="ghost"
                size="sm"
              />
            </HStack>
          </HStack>
        </VStack>
      </Section>

      <Section variant="transparent" padding={0}>
        <CutForm />
      </Section>
    </VStack>
  );
}
