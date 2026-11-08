import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy — Chop Shop",
  description: "Product-level information about data handled by Chop Shop.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy & data handling"
      intro="This page describes data flows visible in the current Chop Shop application source. Actual processing depends on the server, provider, and publishing settings configured by the operator."
      notice="This is an implementation disclosure, not a completed GDPR or CCPA privacy notice. Before public use, the operator must add its legal identity and privacy contact, confirm purposes and legal bases for each processing activity, publish retention periods and transfer details, and provide a working process for privacy requests."
    >
      <section>
        <h2>Information the application may handle</h2>
        <ul>
          <li>Video URLs or video files submitted for processing.</li>
          <li>Project settings, job status, error information, processing logs, and generated clip metadata.</li>
          <li>Transcripts, captions, titles, descriptions, keywords, and exported video files produced by the pipeline.</li>
          <li>Editing preferences and library view/sort preferences saved in browser local storage.</li>
          <li>Scheduled post metadata and publishing status when cloud publishing is enabled.</li>
        </ul>
      </section>
      <section>
        <h2>Where processing happens</h2>
        <p>
          Video processing and job storage use the application runtime and its configured storage paths.
          Speech and language processing can use local Ollama models or external providers such as Groq
          or OpenRouter, depending on configuration. The selected provider may receive the media or
          extracted content required for the configured processing step.
        </p>
        <p className="mt-3">
          Cloud scheduling is optional. When enabled, the application uses the operator-configured
          Supabase project for publishing records and related cloud assets. Publishing to YouTube or
          Instagram sends the selected media and metadata to those services through their APIs.
        </p>
      </section>
      <section>
        <h2>Retention and deletion</h2>
        <p>
          Retention depends on the hosting environment and the operator's configured storage and
          cleanup behavior. The repository does not establish one universal retention period for
          every local job file, exported clip, log, or third-party copy. The operator must publish
          the actual retention schedule and explain how users can request deletion from each
          configured provider.
        </p>
      </section>
      <section>
        <h2>Privacy rights and contact</h2>
        <p>
          No dedicated privacy-request channel or data-controller contact is configured in this
          repository. A public deployment must identify the responsible operator and provide a
          monitored contact method, plus a documented way to request access, correction, export, or
          deletion where applicable under the laws that govern that deployment.
        </p>
      </section>
      <section>
        <h2>Security</h2>
        <p>
          Server-only credentials, including the Supabase service-role key, must remain in protected
          server environment variables and must never be exposed to browser code or committed to the
          repository. Operators should restrict access to the deployment and its storage, and review
          provider permissions before enabling cloud publishing.
        </p>
      </section>
    </LegalPage>
  );
}
