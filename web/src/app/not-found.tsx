import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { Section } from "@astryxdesign/core/Section";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { FilmGlyph, PlusGlyph } from "@/components/StudioIcons";

export default function NotFound() {
  return (
    <VStack
      paddingBlock={10}
      paddingInline={4}
      maxWidth={1360}
      width="100%"
      className="mx-auto sm:px-6 lg:px-8"
    >
      <Section variant="transparent" padding={0}>
        <EmptyState
          icon={<Icon icon={FilmGlyph} />}
          title="Page not found"
          description="This route is missing or the requested cut project was removed from the workspace."
          actions={
            <HStack gap={3} wrap="wrap">
              <Button
                label="Start new cut"
                href="/new"
                variant="primary"
                icon={<Icon icon={PlusGlyph} />}
              />
              <Button label="Open library" href="/library" variant="secondary" />
              <Button label="Overview" href="/" variant="ghost" />
            </HStack>
          }
        />
      </Section>
    </VStack>
  );
}
