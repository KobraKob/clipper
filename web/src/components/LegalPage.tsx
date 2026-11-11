import type { ReactNode } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { Section } from "@astryxdesign/core/Section";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";

type LegalPageProps = {
  title: string;
  intro: string;
  notice: string;
  children: ReactNode;
};

export function LegalPage({ title, intro, notice, children }: LegalPageProps) {
  return (
    <VStack
      gap={6}
      paddingBlock={8}
      paddingInline={4}
      maxWidth={840}
      width="100%"
      className="mx-auto sm:px-6 lg:px-8"
    >
      <Section variant="transparent" padding={0}>
        <VStack gap={6}>
          <Breadcrumbs>
            <BreadcrumbItem href="/">Overview</BreadcrumbItem>
            <BreadcrumbItem isCurrent>{title}</BreadcrumbItem>
          </Breadcrumbs>

          <VStack gap={3}>
            <Text type="label" color="accent">
              OPERATOR DOCUMENTATION
            </Text>
            <Heading level={1} type="display-2">
              {title}
            </Heading>
            <Text type="large" color="secondary">
              {intro}
            </Text>
          </VStack>

          <Banner status="warning" title="Operator notice" description={notice} />

          <Card padding={6} variant="default">
            <VStack gap={6}>
              {children}
            </VStack>
          </Card>

          <Divider />

          <HStack gap={3} wrap="wrap">
            <Button label="Back to overview" href="/" variant="secondary" size="sm" />
            <Button label="Start new cut" href="/new" variant="primary" size="sm" />
            <Button label="Open library" href="/library" variant="ghost" size="sm" />
          </HStack>
        </VStack>
      </Section>
    </VStack>
  );
}
