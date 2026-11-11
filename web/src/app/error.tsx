"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Section } from "@astryxdesign/core/Section";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { RefreshGlyph } from "@/components/StudioIcons";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <VStack
      paddingBlock={10}
      paddingInline={4}
      maxWidth={1360}
      width="100%"
      className="mx-auto sm:px-6 lg:px-8"
    >
      <Section variant="transparent" padding={0}>
        <VStack gap={5} maxWidth={680}>
          <Text type="label" color="accent">
            STUDIO ERROR
          </Text>
          <Heading level={1} type="display-2">
            Something interrupted the studio
          </Heading>
          <Banner
            status="error"
            title="Unhandled workspace error"
            description={error.message || "An unexpected client error occurred."}
          />
          <HStack gap={3} wrap="wrap">
            <Button
              label="Try again"
              variant="primary"
              icon={<Icon icon={RefreshGlyph} />}
              onClick={() => reset()}
            />
            <Button label="Open library" href="/library" variant="secondary" />
            <Button label="Overview" href="/" variant="ghost" />
          </HStack>
        </VStack>
      </Section>
    </VStack>
  );
}
