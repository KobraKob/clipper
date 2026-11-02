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
            <span>Chop Shop video workspace</span>
          </div>
          <h1 className="home-hero-title" id="home-title">
            <span>Find the moment.</span>
            <span>Make the cut.</span>
          </h1>
          <p className="home-hero-copy">
            Turn long-form footage into short-form clips. Review the moments, refine timing and captions, then export what deserves to be watched.
          </p>
          <div className="home-actions">
            <a className="home-button home-button-primary" href="#studio">
              <span>Start a cut</span><span aria-hidden="true">↘</span>
            </a>
            <Link className="home-button home-button-secondary" href="/library">
              Open library <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <div className="home-facts" aria-label="Workflow capabilities">
            <span><i aria-hidden="true" />Local file or URL</span>
            <span><i aria-hidden="true" />Review before export</span>
            <span><i aria-hidden="true" />No watermark</span>
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
            <span>The cut room</span>
            <span>Built to make</span>
          </div>
          <div className="home-image-note">
            <span>Chop Shop</span>
            <b>Make it count.</b>
          </div>
        </div>
      </section>

      <section className="home-section" id="studio" aria-labelledby="studio-title">
        <div className="home-section-head">
          <div>
            <p className="home-section-kicker">Create a project</p>
            <h2 id="studio-title">Start with the footage.</h2>
          </div>
          <p className="home-section-copy">
            Paste a video URL or choose a local file. Set the cut parameters and start the existing pipeline.
          </p>
        </div>

        <div className="home-studio-layout">
          <section className="home-form-panel" aria-label="Create a clipping job">
            <div className="home-panel-head">
              <strong>New video project</strong>
              <span>URL or file</span>
            </div>
            <div className="home-form-content"><CutForm /></div>
            <div className="home-panel-foot">
              <span>Choose your source</span>
              <span>Set your options</span>
            </div>
          </section>

          <aside className="home-next-panel" aria-label="Workspace navigation">
            <p className="home-section-kicker">Your workflow</p>
            <h3>Keep every part in reach.</h3>
            <div className="home-next-step">
              <b>A</b>
              <div>
                <strong>Review your clips</strong>
                <p>Inspect moments, adjust cuts, and tune metadata in each job.</p>
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
                <p>Manage cloud publishing schedules from the calendar.</p>
              </div>
            </div>
            <Link className="home-next-link" href="/library">Go to library <span aria-hidden="true">↗</span></Link>
            <Link className="home-next-link" href="/calendar">Open calendar <span aria-hidden="true">↗</span></Link>
          </aside>
        </div>
      </section>

      <section className="home-section" id="pipeline" aria-labelledby="pipeline-title">
        <div className="home-section-head">
          <div>
            <p className="home-section-kicker">How it works</p>
            <h2 id="pipeline-title">From source to short-form.</h2>
          </div>
          <p className="home-section-copy">
            Eight explicit stages. The pipeline is visible, the output is reviewable, and the final decision stays with you.
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
            <p className="home-section-kicker">Workspace</p>
            <h2 id="workspace-title">Pick up where you left.</h2>
          </div>
          <p className="home-section-copy">
            Move between creation, saved projects, and scheduled posts without losing the path back to your work.
          </p>
        </div>
        <div className="home-tools-grid">
          <Link className="home-tool" href="/library">
            <span><small>Projects</small><strong>Clip library</strong></span>
            <span className="home-tool-arrow" aria-hidden="true">↗</span>
          </Link>
          <Link className="home-tool" href="/calendar">
            <span><small>Distribution</small><strong>Publishing calendar</strong></span>
            <span className="home-tool-arrow" aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>

      <footer className="home-footer">
        <strong>Chop Shop</strong>
        <span>Find the moment. Make the cut.</span>
        <a href="#top">Back to top ↑</a>
      </footer>
    </main>
  );
}
