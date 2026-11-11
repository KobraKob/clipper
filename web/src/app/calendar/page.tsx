import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs";
import { Icon } from "@astryxdesign/core/Icon";
import { Section } from "@astryxdesign/core/Section";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import type { Metadata } from "next";
import { CalendarScheduler } from "@/components/CalendarScheduler";
import { SparklesGlyph } from "@/components/StudioIcons";
import CalendarClient, { type ScheduledPost } from "./calendar-client";

export const metadata: Metadata = {
  title: "Publishing Calendar — Chop Shop",
  description: "Schedule and track YouTube Shorts and Instagram Reels across an editorial calendar.",
};

export const dynamic = "force-dynamic";

async function loadPosts(): Promise<{ posts: ScheduledPost[]; error?: string }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return {
      posts: [],
      error: "Supabase credentials are not configured in web/.env.local.",
    };
  }
  try {
    const res = await fetch(
      `${url.replace(/\/$/, "")}/rest/v1/scheduled_posts?order=scheduled_at.asc`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return {
        posts: [],
        error: `Supabase returned HTTP ${res.status}: ${await res.text()}`,
      };
    }
    const data = (await res.json()) as ScheduledPost[];
    return { posts: Array.isArray(data) ? data : [] };
  } catch (err) {
    return {
      posts: [],
      error: err instanceof Error ? err.message : "Failed to load scheduled posts",
    };
  }
}

export default async function CalendarPage() {
  const { posts, error } = await loadPosts();
  const initialNowIso = new Date().toISOString();

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
            <BreadcrumbItem isCurrent>Calendar</BreadcrumbItem>
          </Breadcrumbs>

          <VStack gap={2} maxWidth={680}>
            <HStack gap={2} align="center">
              <Icon icon={SparklesGlyph} size="sm" color="accent" />
              <Text type="label" color="accent">
                CLOUD SCHEDULING
              </Text>
            </HStack>
            <Heading level={1} type="display-2">
              Publishing Calendar
            </Heading>
            <Text type="large" color="secondary">
              Schedule rendered shorts to YouTube and Instagram, inspect dispatch queues in IST, and retry any failed uploads from one view.
            </Text>
          </VStack>
        </VStack>
      </Section>

      <Section variant="transparent" padding={0}>
        <VStack gap={6}>
          <CalendarScheduler />
          <CalendarClient posts={posts} error={error} initialNowIso={initialNowIso} />
        </VStack>
      </Section>
    </VStack>
  );
}
