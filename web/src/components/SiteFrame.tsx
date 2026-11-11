"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { LayerProvider } from "@astryxdesign/core/Layer";
import { Link, LinkProvider } from "@astryxdesign/core/Link";
import { NavIcon } from "@astryxdesign/core/NavIcon";
import { Section } from "@astryxdesign/core/Section";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { Theme } from "@astryxdesign/core/theme";
import { TopNav, TopNavHeading, TopNavItem } from "@astryxdesign/core/TopNav";
import { VStack } from "@astryxdesign/core/VStack";
import { defaultThemeSlug, themes } from "../astryx-themes";
import { PlusGlyph, ScissorsGlyph } from "@/components/StudioIcons";

const STORAGE_NOTICE_KEY = "chop-shop-storage-notice-v1";

export function SiteFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const [connectionState, setConnectionState] = useState<"offline" | "online" | null>(null);
  const [storageNoticeOpen, setStorageNoticeOpen] = useState(false);

  useEffect(() => {
    try {
      const noticeState = window.localStorage.getItem(STORAGE_NOTICE_KEY) !== "acknowledged";
      queueMicrotask(() => {
        setStorageNoticeOpen(noticeState);
      });
    } catch {
      queueMicrotask(() => {
        setStorageNoticeOpen(false);
      });
    }

    let onlineTimer: number | undefined;
    const handleOffline = () => {
      if (onlineTimer !== undefined) window.clearTimeout(onlineTimer);
      setConnectionState("offline");
    };
    const handleOnline = () => {
      setConnectionState("online");
      if (onlineTimer !== undefined) window.clearTimeout(onlineTimer);
      onlineTimer = window.setTimeout(() => setConnectionState(null), 3500);
    };

    if (!navigator.onLine) {
      queueMicrotask(() => {
        setConnectionState("offline");
      });
    }
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      if (onlineTimer !== undefined) window.clearTimeout(onlineTimer);
    };
  }, []);

  function dismissStorageNotice() {
    try {
      window.localStorage.setItem(STORAGE_NOTICE_KEY, "acknowledged");
    } catch {
      // Notice can still be dismissed for the active session.
    }
    setStorageNoticeOpen(false);
  }

  const topNav = (
    <TopNav
      label="Primary navigation"
      heading={
        <TopNavHeading
          logo={<NavIcon icon={<Icon icon={ScissorsGlyph} size="sm" />} />}
          heading="CHOP SHOP"
          subheading="AI Cut Room"
          headingHref="/"
        />
      }
      startContent={
        <>
          <TopNavItem href="/" label="Overview" isSelected={pathname === "/"} />
          <TopNavItem href="/new" label="New Cut" isSelected={pathname === "/new"} />
          <TopNavItem
            href="/library"
            label="Library"
            isSelected={pathname.startsWith("/library") || pathname.startsWith("/jobs")}
          />
          <TopNavItem href="/calendar" label="Calendar" isSelected={pathname.startsWith("/calendar")} />
        </>
      }
      endContent={
        <HStack gap={3} vAlign="center">
          <HStack gap={1.5} vAlign="center" className="hidden lg:flex">
            <StatusDot variant="success" isPulsing label="Local-first engine active" />
            <Text type="supporting" size="sm">
              Local Engine
            </Text>
          </HStack>
          <Button
            href="/new"
            label="New Cut"
            variant="primary"
            size="md"
            icon={<Icon icon={PlusGlyph} size="xsm" />}
          />
        </HStack>
      }
    />
  );

  const connectionBanner = connectionState ? (
    <Banner
      container="section"
      status={connectionState === "offline" ? "error" : "success"}
      title={connectionState === "offline" ? "You are offline" : "Connection restored"}
      description={
        connectionState === "offline"
          ? "Local views stay available. Video uploads and cloud publishing require an active connection."
          : undefined
      }
      isDismissable={connectionState === "online"}
      onDismiss={() => setConnectionState(null)}
    />
  ) : undefined;

  return (
    <Theme theme={themes[defaultThemeSlug]} mode="dark">
      <LayerProvider>
        <LinkProvider component={NextLink}>
          <AppShell
            height="auto"
            variant="section"
            contentPadding={0}
            topNav={topNav}
            banner={connectionBanner}
          >
            <VStack gap={0} minHeight="calc(100dvh - 4rem)">
              <VStack gap={0} className="flex-1">
                {children}
              </VStack>

              <Section variant="muted" dividers={["top"]} paddingBlock={6} paddingInline={4}>
                <VStack as="footer" gap={5} maxWidth={1360} width="100%" className="mx-auto px-2 sm:px-4">
                  <HStack gap={4} hAlign="between" vAlign="center" wrap="wrap">
                    <HStack gap={2} vAlign="center" wrap="wrap">
                      <Text weight="bold" size="base">
                        CHOP SHOP
                      </Text>
                      <Text type="supporting" size="2xs">
                        /
                      </Text>
                      <Text type="supporting" size="2xs">
                        Local-first vertical video cut room & publishing studio
                      </Text>
                    </HStack>

                    <HStack as="nav" aria-label="Footer navigation" gap={5} vAlign="center" wrap="wrap">
                      <Link href="/" isStandalone size="xsm" color="secondary">
                        Overview
                      </Link>
                      <Link href="/new" isStandalone size="xsm" color="secondary">
                        New Cut
                      </Link>
                      <Link href="/library" isStandalone size="xsm" color="secondary">
                        Library
                      </Link>
                      <Link href="/calendar" isStandalone size="xsm" color="secondary">
                        Calendar
                      </Link>
                    </HStack>
                  </HStack>

                  <Divider />

                  <HStack gap={4} hAlign="between" vAlign="center" wrap="wrap">
                    <Text type="supporting" size="2xs">
                      © {new Date().getFullYear()} Chop Shop. All rights reserved.
                    </Text>

                    <HStack as="nav" aria-label="Legal and privacy" gap={5} vAlign="center" wrap="wrap">
                      <Link href="/privacy" isStandalone size="xsm" color="secondary">
                        Privacy
                      </Link>
                      <Link href="/terms" isStandalone size="xsm" color="secondary">
                        Terms
                      </Link>
                      <Link href="/cookies" isStandalone size="xsm" color="secondary">
                        Cookies & storage
                      </Link>
                    </HStack>

                    <Text type="code" size="2xs" color="secondary">
                      Local-first processing · Cloud publishing optional
                    </Text>
                  </HStack>
                </VStack>
              </Section>
            </VStack>

            {storageNoticeOpen ? (
              <VStack
                as="aside"
                role="region"
                aria-label="Browser storage notice"
                maxWidth={480}
                className="fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] sm:bottom-6 sm:right-6"
              >
                <Card elevation="high" padding={3}>
                  <Banner
                    status="info"
                    title="Browser storage notice"
                    description="Chop Shop saves cut preferences and library display settings in this browser. No advertising or analytics cookies are configured."
                    isDismissable
                    onDismiss={dismissStorageNotice}
                    endContent={
                      <Link href="/cookies" isStandalone size="xsm">
                        Storage details
                      </Link>
                    }
                  />
                </Card>
              </VStack>
            ) : null}
          </AppShell>
        </LinkProvider>
      </LayerProvider>
    </Theme>
  );
}
