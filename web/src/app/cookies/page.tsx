import type { Metadata } from "next";
import { Heading } from "@astryxdesign/core/Heading";
import { List, ListItem } from "@astryxdesign/core/List";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Cookies & storage — Chop Shop",
  description: "How Chop Shop uses browser storage and cookies.",
};

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookies & browser storage"
      intro="The current frontend stores a small set of functional preferences in browser local storage. Local storage is not the same technology as an HTTP cookie."
      notice="The checked-in frontend does not configure advertising or analytics cookies. This source review cannot certify cookies or scripts injected by a hosting layer, custom domain, browser extension, or later deployment change. Recheck the live deployment whenever those integrations change."
    >
      <VStack as="section" gap={3}>
        <Heading level={2}>Functional browser storage</Heading>
        <List hasDividers={false} edge="outset">
          <ListItem
            itemKey="cut-form"
            label={<Text color="secondary">The Cut form stores selected editing settings so they can be restored on the next visit.</Text>}
          />
          <ListItem
            itemKey="library"
            label={<Text color="secondary">The Library stores the selected grid/list view and sort preference.</Text>}
          />
          <ListItem
            itemKey="notice"
            label={<Text color="secondary">The browser-storage notice stores a local acknowledgement after it is dismissed.</Text>}
          />
        </List>
        <Text color="secondary">
          These items support application functionality and do not create an advertising profile.
          Clearing site data in your browser removes these preferences and causes the notice to
          appear again.
        </Text>
      </VStack>
      <VStack as="section" gap={3}>
        <Heading level={2}>Cookies and third-party services</Heading>
        <Text color="secondary">
          No advertising or analytics cookie integration is present in the frontend source reviewed
          for this release. If optional analytics, advertising, or other non-essential tracking is
          introduced later, it must be blocked until the required user choice is obtained and users
          must be able to change that choice.
        </Text>
        <Text color="secondary">
          When you follow an external provider flow or publish content, the provider may use its own
          cookies and privacy technologies under its own policy.
        </Text>
      </VStack>
      <VStack as="section" gap={2}>
        <Heading level={2}>Current notice behavior</Heading>
        <Text color="secondary">
          Chop Shop displays a dismissible browser-storage notice. It explains the functional
          preference storage and links to this page. Since the reviewed frontend does not configure
          non-essential tracking cookies, the notice does not offer a misleading &ldquo;accept all&rdquo;
          analytics choice.
        </Text>
      </VStack>
    </LegalPage>
  );
}
