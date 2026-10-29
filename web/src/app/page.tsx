import Link from "next/link";
import { CutForm } from "@/components/CutForm";
import { PhoneStack } from "@/components/PhoneStack";
import { PIPELINE_STAGES } from "@/lib/types";

const PROCESS_DETAILS = [
  "Accept a video URL or a local source file.",
  "Create word-level timestamps from speech.",
  "Scan long footage for promising moments.",
  "Rank hooks and remove overlapping candidates.",
  "Cut precise segments around selected moments.",
  "Keep the speaker framed for vertical viewing.",
  "Burn in timed captions with your chosen style.",
  "Export clips and accompanying metadata.",
];

export default function Home() {
  return (
    <main className="clipper-page ux-page" id="top">
      <div className="ux-announce">
        <div className="ux-announce-inner">
          <span className="ux-live-dot" aria-hidden="true" />
          <span>INDEPENDENT VIDEO WORKSHOP</span>
          <span className="ux-announce-separator">/</span>
          <span>NO TEMPLATE-FACTORY ENERGY</span>
          <span className="ux-announce-status"><span aria-hidden="true" /> SYSTEM READY</span>
        </div>
      </div>

      <div className="ux-motion-ticker" aria-label="Chop Shop workflow in motion">
        <div className="ux-motion-track">
          <span>FIND THE HOOK <b>✳</b></span>
          <span>KEEP THE SUBJECT IN FRAME <b>↗</b></span>
          <span>WORD-SYNC CAPTIONS <b>✳</b></span>
          <span>EXPORT WITHOUT WATERMARKS <b>↗</b></span>
          <span>FIND THE HOOK <b>✳</b></span>
          <span>KEEP THE SUBJECT IN FRAME <b>↗</b></span>
          <span>WORD-SYNC CAPTIONS <b>✳</b></span>
          <span>EXPORT WITHOUT WATERMARKS <b>↗</b></span>
        </div>
      </div>

      <section className="ux-hero" aria-labelledby="hero-title">
        <div className="ux-hero-copy">
          <div className="ux-kicker">
            <span className="ux-kicker-mark" aria-hidden="true">C/</span>
            <span>CHOP SHOP / CUT ROOM</span>
          </div>

          <h1 className="ux-title" id="hero-title">
            Raw footage.
            <br />
            <span className="ux-title-secondary">No wasted frames.</span>
            <br />
            <span className="ux-title-accent">Make the cut.</span>
          </h1>

          <p className="ux-lede">
            Find the moments worth sharing. Chop Shop tears through podcasts, streams,
            lectures, and interviews to find the moments worth keeping—without
            hours of scrubbing.
          </p>

          <div className="ux-hero-actions">
            <a className="ux-button ux-button-primary" href="#studio">
              <span>Create clips</span>
              <span className="ux-button-arrow" aria-hidden="true">↘</span>
            </a>
            <a className="ux-button ux-button-secondary" href="#pipeline">
              Explore the workflow
              <span aria-hidden="true">↗</span>
            </a>
          </div>

          <div className="ux-trust-row" aria-label="Product principles">
            <span><i aria-hidden="true" /> No watermark</span>
            <span><i aria-hidden="true" /> Local or cloud</span>
            <span><i aria-hidden="true" /> Open source</span>
          </div>
        </div>

        <div className="ux-hero-visual">
          <div className="ux-preview-card">
            <div className="ux-preview-head">
              <div className="ux-preview-file">
                <span className="ux-file-icon" aria-hidden="true">▶</span>
                <span>
                  <strong>OUTPUT PREVIEW</strong>
                  <small>VERTICAL FORMAT / 9:16</small>
                </span>
              </div>
              <span className="ux-live-badge"><i aria-hidden="true" /> LIVE FRAME</span>
            </div>

            <div className="ux-preview-stage">
              <div className="ux-preview-grid" aria-hidden="true" />
              <div className="ux-preview-coordinate ux-preview-coordinate-top">FRAME / 001</div>
              <div className="ux-phone-window" aria-hidden="true">
                <PhoneStack />
              </div>
              <div className="ux-float-label ux-float-label-top">
                <span className="ux-float-label-icon" aria-hidden="true">↗</span>
                <span><small>MOMENT FOUND</small><strong>Hook detected</strong></span>
              </div>
              <div className="ux-float-label ux-float-label-bottom">
                <span className="ux-audio-bars" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
                <span><small>CAPTION TIMING</small><strong>Word-level sync</strong></span>
              </div>
            </div>

            <div className="ux-preview-foot">
              <span><i aria-hidden="true" /> SUBJECT TRACKING</span>
              <span>1080 × 1920 <b>·</b> MP4</span>
            </div>
          </div>
          <div className="ux-side-note"><span>01</span> ONE SOURCE. THE GOOD PARTS.</div>
        </div>
      </section>

      <section className="ux-spec-strip" aria-label="Clipper capabilities">
        <div className="ux-spec-item">
          <strong>9:16</strong>
          <span>Vertical-first output</span>
        </div>
        <div className="ux-spec-item">
          <strong>1080p+</strong>
          <span>High-resolution exports</span>
        </div>
        <div className="ux-spec-item">
          <strong>Word-level</strong>
          <span>Animated captions</span>
        </div>
        <div className="ux-spec-item">
          <strong>₹0</strong>
          <span>Open-source workflow</span>
        </div>
      </section>

      <section className="ux-process section-anchor" id="pipeline" aria-labelledby="pipeline-title">
        <div className="ux-section-heading">
          <div className="ux-section-index"><span>01</span><span className="ux-index-line" /><span>THE WORKFLOW</span></div>
          <div className="ux-section-heading-row">
            <div>
              <h2 className="ux-section-title" id="pipeline-title">From full-length to <span>feed-ready.</span></h2>
              <p className="ux-section-description">
                A clear pipeline. No mystery editing steps. Keep control over
                the model, framing, captions, and final export.
              </p>
            </div>
            <a className="ux-text-link" href="#studio">Start with a source <span aria-hidden="true">↘</span></a>
          </div>
        </div>

        <div className="ux-process-grid">
          {PIPELINE_STAGES.map((stage, index) => (
            <article className="ux-process-card" key={stage.id}>
              <div className="ux-process-card-top">
                <span className="ux-process-number">0{index + 1}</span>
                <span className="ux-process-symbol" aria-hidden="true">
                  {["⇩", "≋", "⌕", "◉", "✂", "▣", "≡", "↗"][index] ?? "↗"}
                </span>
              </div>
              <h3>{stage.label}</h3>
              <p>{PROCESS_DETAILS[index] ?? "Move through the clipping workflow with control over each step."}</p>
              <div className="ux-process-rule" aria-hidden="true"><span /></div>
            </article>
          ))}
        </div>
      </section>

      <section className="ux-studio section-anchor" id="studio" aria-labelledby="studio-title">
        <div className="ux-section-index"><span>02</span><span className="ux-index-line" /><span>THE EDIT BAY</span></div>

        <div className="ux-studio-heading">
          <div>
            <h2 className="ux-section-title" id="studio-title">Start with <span>your source.</span></h2>
            <p className="ux-section-description">
              Paste a video URL or choose a local file. Set your options,
              launch the pipeline, and review the results in your library.
            </p>
          </div>
          <div className="ux-studio-state">
            <span className="ux-state-light" aria-hidden="true" />
            <span><small>WORKSPACE STATUS</small><strong>Ready for input</strong></span>
          </div>
        </div>

        <div className="ux-studio-layout">
          <div className="ux-source-panel">
            <div className="ux-panel-heading">
              <div>
                <span className="ux-panel-eyebrow">SOURCE INPUT / 001</span>
                <h3>Ingest media</h3>
              </div>
              <span className="ux-panel-tag">URL or upload</span>
            </div>
            <div className="ux-source-form">
              <CutForm />
            </div>
            <div className="ux-panel-foot">
              <span>SUPPORTED: VIDEO URLS / LOCAL FILES</span>
              <span>NO WATERMARK OUTPUT</span>
            </div>
          </div>

          <aside className="ux-studio-aside" aria-label="What happens next">
            <div className="ux-aside-heading">
              <span className="ux-panel-eyebrow">AFTER YOU START</span>
              <h3>Built for the whole workflow.</h3>
            </div>
            <article className="ux-benefit">
              <span className="ux-benefit-number">A</span>
              <div><h4>Choose your engine</h4><p>Use a local model for privacy or a supported cloud provider for speed.</p></div>
            </article>
            <article className="ux-benefit">
              <span className="ux-benefit-number">B</span>
              <div><h4>Review each cut</h4><p>Fine-tune timing, framing, titles, and caption styles before exporting.</p></div>
            </article>
            <article className="ux-benefit">
              <span className="ux-benefit-number">C</span>
              <div><h4>Export and publish</h4><p>Download the clip and metadata, or use the publishing tools when connected.</p></div>
            </article>
            <div className="ux-privacy-note">
              <span className="ux-privacy-icon" aria-hidden="true">⌑</span>
              <p><strong>Your workflow, your choice.</strong><br />Provider options and credentials stay under your control.</p>
            </div>
            <Link className="ux-library-link" href="/library">Open your clip library <span aria-hidden="true">↗</span></Link>
          </aside>
        </div>
      </section>

      <section className="ux-principles" aria-labelledby="principles-title">
        <div className="ux-principles-heading">
          <div className="ux-section-index"><span>03</span><span className="ux-index-line" /><span>THE PRINCIPLES</span></div>
          <h2 className="ux-section-title" id="principles-title">Less busywork.<br /><span>More useful output.</span></h2>
        </div>
        <div className="ux-principles-grid">
          <article className="ux-principle-card">
            <span className="ux-principle-mark" aria-hidden="true">01 /</span>
            <h3>Keep the subject in frame.</h3>
            <p>Face-aware vertical reframing keeps speakers visible instead of shrinking them into a wide shot.</p>
          </article>
          <article className="ux-principle-card ux-principle-card-accent">
            <span className="ux-principle-mark" aria-hidden="true">02 /</span>
            <h3>Captions that keep pace.</h3>
            <p>Word-timed caption styles turn speech into readable, social-ready clips.</p>
          </article>
          <article className="ux-principle-card">
            <span className="ux-principle-mark" aria-hidden="true">03 /</span>
            <h3>Control the final cut.</h3>
            <p>Review titles, choose variants, adjust timing, and keep export metadata with your work.</p>
          </article>
        </div>
      </section>

      <footer className="ux-footer">
        <Link href="/" className="ux-footer-brand" aria-label="Clipper home"><span>C/</span> CLIPPER</Link>
        <p>Open-source tooling for creators who have better things to do than scrub timelines.</p>
        <div className="ux-footer-links"><a href="#top">Back to top ↑</a><Link href="/library">Library ↗</Link></div>
        <div className="ux-footer-meta"><span>LOCAL-FIRST OPTIONS</span><span>NO WATERMARK</span><span>BUILT FOR SHORT FORM</span></div>
      </footer>
    </main>
  );
}
