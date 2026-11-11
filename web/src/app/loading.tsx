import { Grid } from "@astryxdesign/core/Grid";
import { Section } from "@astryxdesign/core/Section";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";

export default function Loading() {
  return (
    <VStack
      paddingBlock={8}
      paddingInline={4}
      maxWidth={1360}
      width="100%"
      className="mx-auto sm:px-6 lg:px-8"
    >
      <Section variant="transparent" padding={0}>
        <VStack gap={6}>
          <Skeleton height={44} width={280} />
          <Skeleton height={22} width="60%" />
          <Grid columns={{ minWidth: 260, max: 3 }} gap={4}>
            <Skeleton height={200} width="100%" />
            <Skeleton height={200} width="100%" />
            <Skeleton height={200} width="100%" />
          </Grid>
        </VStack>
      </Section>
    </VStack>
  );
}
