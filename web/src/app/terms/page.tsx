import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms — Chop Shop",
  description: "Draft product-use terms for Chop Shop.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      intro="These draft terms summarize responsible use of the Chop Shop video clipping application. They are not a substitute for a reviewed agreement from the service operator."
      notice="Do not present this draft as binding Terms & Conditions. The operator must supply the contracting legal entity, jurisdiction and governing law, support contact, service and payment terms (if any), liability and warranty language, and any other terms required for the actual deployment."
    >
      <section>
        <h2>Your content and permissions</h2>
        <p>
          You are responsible for the videos, audio, transcripts, images, names, and other material
          you submit. Before processing or publishing content, obtain the rights, licenses,
          permissions, and participant consents required for your use, including rights of publicity
          and privacy where applicable.
        </p>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <p>
          Do not use the application to violate laws, infringe another person's rights, distribute
          unlawful material, evade platform restrictions, or interfere with the application or its
          infrastructure. You are responsible for reviewing generated clips, captions, titles,
          descriptions, and tags before sharing them.
        </p>
      </section>
      <section>
        <h2>Third-party services</h2>
        <p>
          Optional model providers, Supabase, YouTube, and Instagram are separate services. Their
          availability, processing, fees, permissions, and terms are controlled by those providers.
          Enabling a provider or publishing integration may transmit the relevant content and
          metadata to that provider.
        </p>
      </section>
      <section>
        <h2>Output and review</h2>
        <p>
          Automated transcripts, clip selection, reframing, captions, and metadata can contain
          mistakes. Review all output for accuracy, context, rights, and platform requirements.
          Keep independent copies of source files and important exports.
        </p>
      </section>
      <section>
        <h2>Availability and operator details</h2>
        <p>
          Processing depends on the host machine, installed software, network access, model
          providers, and configured integrations. No uptime or completion guarantee is stated here.
          The responsible operator, support route, applicable law, and any commercial terms must be
          added before this page is used as a binding agreement.
        </p>
      </section>
    </LegalPage>
  );
}
