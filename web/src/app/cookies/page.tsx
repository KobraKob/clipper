import type { Metadata } from "next";
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
      <section>
        <h2>Functional browser storage</h2>
        <ul>
          <li>The Cut form stores selected editing settings so they can be restored on the next visit.</li>
          <li>The Library stores the selected grid/list view and sort preference.</li>
          <li>The browser-storage notice stores a local acknowledgement after it is dismissed.</li>
        </ul>
        <p className="mt-3">
          These items support application functionality and do not create an advertising profile.
          Clearing site data in your browser removes these preferences and causes the notice to
          appear again.
        </p>
      </section>
      <section>
        <h2>Cookies and third-party services</h2>
        <p>
          No advertising or analytics cookie integration is present in the frontend source reviewed
          for this release. If optional analytics, advertising, or other non-essential tracking is
          introduced later, it must be blocked until the required user choice is obtained and users
          must be able to change that choice.
        </p>
        <p className="mt-3">
          When you follow an external provider flow or publish content, the provider may use its own
          cookies and privacy technologies under its own policy.
        </p>
      </section>
      <section>
        <h2>Current notice behavior</h2>
        <p>
          Chop Shop displays a dismissible browser-storage notice. It explains the functional
          preference storage and links to this page. Since the reviewed frontend does not configure
          non-essential tracking cookies, the notice does not offer a misleading "accept all"
          analytics choice.
        </p>
      </section>
    </LegalPage>
  );
}
