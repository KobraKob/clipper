import Image from "next/image";
import Link from "next/link";
import { CutForm } from "@/components/CutForm";
import { PIPELINE_STAGES } from "@/lib/types";

const PROCESS_DETAILS = [
  "Bring in a video URL or a file from your machine.",
  "Turn speech into a searchable, timed transcript.",
  "Find candidate moments across the source.",
  "Rank hooks and remove overlapping segments.",
  "Cut the selected ranges precisely.",
  "Keep the subject framed for vertical playback.",
  "Apply readable, timed captions.",
  "Export the finished clips and their metadata.",
];

export default function Home() {
  return (
    <main className="clipper-page home-page" id="top">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-copy">
          <div className="home-kicker">
            <span className="home-kicker-mark" aria-hidden="true">CS/</span>
            <span>CHOP SHOP / VIDEO CUT ROOM</span>
          </div>

          <h1 className="home-hero-title" id="home-title">
            <span>FIND THE</span>
            <span className="home-title-red">MOMENT.</span>
            <span>MAKE THE</span>
            <span className="home-title-yellow">CUT.</span>
          </h1>

          <p className="home-hero-copy">
            Turn long-form footage into short-form clips. Bring a source,
            review the cuts, refine timing and captions, then export what
            deserves to be watched.
          </p>

          <div className="home-actions">
            <a className="home-button home-button-primary" href="#studio">
              <span>Start a cut</span>
              <span aria-hidden="true">↘</span>
            </a>
            <Link className="home-button home-button-secondary" href="/library">
              Open library <span aria-hidden="true">↗</span>
            </Link>
          </div>

          <div className="home-facts" aria-label="Workflow capabilities">
            <span><i aria-hidden="true" /> Local file or URL</span>
            <span><i aria-hidden="true" /> Review before export</span>
            <span><i aria-hidden="true" /> No watermark</span>
          </div>
        </div>

        <div className="home-portrait-wrap">
          <div className="home-portrait">
            <Image
              src="/images/founder-portrait.webp"
              alt="Founder portrait in a black shirt, lit by a horizontal red beam"
              fill
              priority
              sizes="(max-width: 760px) 90vw, 38vw"
              quality={82}
              className="home-founder-image"
            />
            <span className="home-portrait-index" aria-hidden="true">01</span>
          </div>
          <div className="home-portrait-rail">
            <span>THE CUT ROOM</span>
            <span>BUILT TO MAKE</span>
          </div>
          <div className="home-image-note">
            <span>CHOP SHOP / 01</span>
            <b>MAKE IT COUNT.</b>
          </div>
        </div>
      </section>

      <section className="home-section" id="studio" aria-labelledby="studio-title">
        <div className="home-section-head">
          <div>
            <p className="home-section-kicker">01 / SOURCE IN</p>
            <h2 id="studio-title">Start with<br /><span>the footage.</span></h2>
          </div>
          <p className="home-section-copy">
            Paste a video URL or choose a local file. Set the cut parameters
            and start the existing pipeline. Your projects and editing tools
            stay in the workspace.
          </p>
        </div>

        <div className="home-studio-layout">
          <section className="home-form-panel" aria-label="Create a clipping job">
            <div className="home-panel-head">
              <strong>01 / Ingest source</strong>
              <span>URL OR FILE</span>
            </div>
            <div className="home-form-content">
              <CutForm />
            </div>
            <div className="home-panel-foot">
              <span>CHOOSE YOUR SOURCE</span>
              <span>SET YOUR OPTIONS</span>
            </div>
          </section>

          <aside className="home-next-panel" aria-label="Workspace navigation">
            <p className="home-section-kicker">02 / KEEP MOVING</p>
            <h3>Everything<br />has a place.</h3>

            <div className="home-next-step">
              <b>A</b>
              <div>
                <strong>Review your clips</strong>
                <p>Open a job to inspect moments, adjust cuts, and tune metadata.</p>
              </div>
            </div>
            <div className="home-next-step">
              <b>B</b>
              <div>
                <strong>Manage your library</strong>
                <p>Find saved projects and return to unfinished work.</p>
              </div>
            </div>
            <div className="home-next-step">
              <b>C</b>
              <div>
                <strong>Schedule distribution</strong>
                <p>Open the calendar to manage cloud publishing schedules.</p>
              </div>
            </div>

            <Link className="home-next-link" href="/library">
              Go to library <span aria-hidden="true">↗</span>
            </Link>
            <Link className="home-next-link" href="/calendar">
              Open calendar <span aria-hidden="true">↗</span>
            </Link>
          </aside>
        </div>
      </section>

      <section className="home-section" id="pipeline" aria-labelledby="pipeline-title">
        <div className="home-section-head">
          <div>
            <p className="home-section-kicker">02 / THE PIPELINE</p>
            <h2 id="pipeline-title">From source<br /><span>to short-form.</span></h2>
          </div>
          <p className="home-section-copy">
            Eight explicit stages. The pipeline is visible, the output is
            reviewable, and the final decision stays with you.
          </p>
        </div>

        <div className="home-process-grid">
          {PIPELINE_STAGES.map((stage, index) => (
            <article className="home-process-card" key={stage.id}>
              <span className="home-process-number">{String(index + 1).padStart(2, "0")}</span>
              <h3>{stage.label}</h3>
              <p>{PROCESS_DETAILS[index]}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-section" aria-labelledby="workspace-title">
        <div className="home-section-head">
          <div>
            <p className="home-section-kicker">03 / WORKSPACE</p>
            <h2 id="workspace-title">Pick up<br /><span>where you left.</span></h2>
          </div>
          <p className="home-section-copy">
            Move between creation, saved projects, and scheduled posts without
            losing the path back to your work.
          </p>
        </div>
        <div className="home-tools-grid">
          <Link className="home-tool" href="/library">
            <span>
              <small>01 / PROJECTS</small>
              <strong>Clip library</strong>
            </span>
            <span className="home-tool-arrow" aria-hidden="true">↗</span>
          </Link>
          <Link className="home-tool" href="/calendar">
            <span>
              <small>02 / DISTRIBUTION</small>
              <strong>Publishing calendar</strong>
            </span>
            <span className="home-tool-arrow" aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>

      <footer className="home-footer">
        <strong>CS/ CHOP SHOP</strong>
        <span>FIND THE MOMENT. MAKE THE CUT.</span>
        <a href="#top">Back to top ↑</a>
      </footer>
    </main>
  );
}
