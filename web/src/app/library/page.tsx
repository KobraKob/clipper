import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Section } from "@astryxdesign/core/Section";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import type { Metadata } from "next";
import { LibraryGrid } from "@/components/LibraryGrid";
import { FilmGlyph, PlusGlyph } from "@/components/StudioIcons";

export const metadata: Metadata = {
  title: "Cut Library — Chop Shop",
  description:
    "Browse, filter, search, batch-import, and manage all your Chop Shop cut runs.",
};

export default function LibraryPage() {
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
            <BreadcrumbItem isCurrent>Library</BreadcrumbItem>
          </Breadcrumbs>

          <HStack justify="between" align="end" wrap="wrap" gap={4}>
            <VStack gap={2} maxWidth={680}>
              <HStack gap={2} align="center">
                <Icon icon={FilmGlyph} size="sm" color="accent" />
                <Text type="label" color="accent">
                  SAVED PROJECTS
                </Text>
              </HStack>
              <Heading level={1} type="display-2">
                Cut Library
              </Heading>
              <Text type="large" color="secondary">
                Every pipeline run lives here. Track live extractions, batch-import folders of source videos, and jump straight into any clip studio.
              </Text>
            </VStack>

            <HStack gap={2} wrap="wrap">
              <Button label="Calendar" href="/calendar" variant="secondary" size="sm" />
              <Button
                label="New cut"
                href="/new"
                variant="primary"
                size="sm"
                icon={<Icon icon={PlusGlyph} />}
              />
            </HStack>
          </HStack>
        </VStack>
      </Section>

      <Section variant="transparent" padding={0}>
        <LibraryGrid />
      </Section>
    </VStack>
  );
}
