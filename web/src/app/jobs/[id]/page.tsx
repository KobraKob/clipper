import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs";
import { Section } from "@astryxdesign/core/Section";
import { VStack } from "@astryxdesign/core/Stack";
import type { Metadata } from "next";
import { JobStudio } from "@/components/JobStudio";

export const metadata: Metadata = {
  title: "Job Studio — Chop Shop",
  description: "Review, trim, re-render, caption, and publish extracted short clips.",
};

export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <VStack
      gap={5}
      paddingBlock={6}
      paddingBlockEnd={10}
      paddingInline={4}
      maxWidth={1360}
      width="100%"
      className="mx-auto sm:px-6 lg:px-8"
    >
      <Section variant="transparent" padding={0}>
        <VStack gap={5}>
          <Breadcrumbs>
            <BreadcrumbItem href="/">Overview</BreadcrumbItem>
            <BreadcrumbItem href="/library">Library</BreadcrumbItem>
            <BreadcrumbItem isCurrent>Job Studio</BreadcrumbItem>
          </Breadcrumbs>

          <JobStudio jobId={id} />
        </VStack>
      </Section>
    </VStack>
  );
}
