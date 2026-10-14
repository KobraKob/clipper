import { CutForm } from "@/components/CutForm";
import { PhoneStack } from "@/components/PhoneStack";
import { PIPELINE_STAGES } from "@/lib/types";

const TICKER_TOP = [
  "LONG FORM IS ON NOTICE",
  "HOOK FIRST, LORE LATER",
  "9:16 OR IT DIDN'T HAPPEN",
  "YOUR EDITOR CAN BLINK NOW",
  "LESS SCROLL-BY, MORE STOP-BY",
];

const TICKER_BOTTOM = [
  "NO WATERMARK. NO DRAMA.",
  "CUT THE DEAD AIR",
  "LET THE GOOD BIT COOK",
  "CONTENT, NOT CONTENT-FARM VIBES",
  "THE ALGORITHM IS NOT YOUR THERAPIST",
];

function Ticker({
  items,
  className = "",
  reverse = false,
}: {
  items: string[];
  className?: string;
  reverse?: boolean;
}) {
  const row = (
    <div className="marquee-track" aria-hidden="true">
      {items.map((item, i) => (
        <span key={item} className="ticker-item">
          {item}
          <span className={i % 2 === 0 ? "ticker-mark ticker-mark--lime" : "ticker-mark ticker-mark--red"}>
            {i % 2 === 0 ? "✳" : "↗"}
          </span>
        </span>
      ))}
    </div>
  );

  return (
    <div className={`marquee ${reverse ? "marquee-reverse" : ""} ${className}`}>
      {row}
      {row}
    </div>
  );
}

function SectionIndex({ number, label }: { number: string; label: string }) {
  return (
    <div className="section-index">
      <span>{number}</span>
      <span className="section-index-line" />
      <span>{label}</span>
    </div>
  );
}

function SignalBars() {
  return (
    <div className="signal-bars" aria-label="Audio signal visualisation">
      {Array.from({ length: 36 }, (_, i) => (
        <span key={i} className={`signal-bar signal-bar--${(i % 5) + 1}`} />
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <main className="clipper-page">
      <div className="topline">
        <span className="topline-led" />
        <span>INDEPENDENT CREATOR TOOLING</span>
        <span className="topline-divider">/</span>
        <span>OPEN SOURCE BY DESIGN</span>
        <span className="topline-status"><span /> SYSTEM READY</span>
      </div>

      <header className="masthead">
        <a href="#top" className="wordmark" aria-label="Clipper home">
          <span className="wordmark-symbol">C<span>/</span></span>
          <span>CLIPPER<span className="wordmark-sub">MEDIA EXTRACTION UNIT</span></span>
        </a>
        <nav className="masthead-nav" aria-label="Main navigation">
          <a href="#pipeline">THE PIPELINE</a>
          <a href="#studio">THE EDIT BAY</a>
          <span className="nav-chip">BUILD 0.9 / NO BS</span>
        </nav>
      </header>

      <Ticker items={TICKER_TOP} className="ticker ticker--top" />

      <section id="top" className="hero-stage">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-coordinate hero-coordinate--top" aria-hidden="true">12° / FRAME LOCKED</div>
        <div className="hero-coordinate hero-coordinate--bottom" aria-hidden="true">REC • 00:00:03:12</div>

        <div className="hero-layout">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> THE OPEN-SOURCE CLIP LAB <span className="eyebrow-code">[ 9:16 MODE ]</span></div>
            <h1 className="hero-title">
              YOUR LONG VIDEO
              <br />
              HAS <span className="hero-title-cut">THREE GOOD</span>
              <br />
              <span className="hero-title-last">MINUTES.</span>
            </h1>
            <div className="hero-subline">
              <span className="hero-slash">{"//"}</span>
              <p>Let’s find them before the group chat loses interest.</p>
            </div>
            <p className="hero-description">
              Turn podcasts, lectures, streams, and talking-head footage into punchy vertical clips.
              We transcribe, score, cut, reframe, and caption. You can stop scrubbing through 47 minutes
              to find one usable sentence.
            </p>
            <div className="hero-actions">
              <a className="button-primary" href="#studio"><span>OPEN THE EDIT BAY</span><span className="button-arrow">↘</span></a>
              <div className="hero-action-note"><span className="tiny-cross">✳</span> Free to run. No watermark. Your call on local vs cloud.</div>
            </div>
            <div className="hero-specs" aria-label="Product specifications">
              <div><strong>9:16</strong><span>VERTICAL NATIVE</span></div>
              <div><strong>00:03</strong><span>HOOK WINDOW*</span></div>
              <div><strong>0%</strong><span>WATERMARK ENERGY</span></div>
            </div>
            <p className="micro-note">*A strong opening helps. Viral is not a legally binding promise.</p>
          </div>

          <div className="hero-visual">
            <div className="visual-topline"><span>FIG. 01 — OUTPUT PREVIEW</span><span>LIVE FRAME / 9:16</span></div>
            <div className="preview-housing">
              <div className="preview-corner preview-corner--tl" />
              <div className="preview-corner preview-corner--tr" />
              <div className="preview-corner preview-corner--bl" />
              <div className="preview-corner preview-corner--br" />
              <div className="preview-ruler preview-ruler--left" aria-hidden="true"><span>01</span><span>02</span><span>03</span><span>04</span></div>
              <div className="phone-stack-wrap"><PhoneStack /></div>
              <div className="preview-hud preview-hud--top"><span className="hud-led" /> SUBJECT TRACKING <strong>ACTIVE</strong></div>
              <div className="preview-hud preview-hud--bottom"><span>CAPTIONS SYNCED</span><strong>98.4%</strong></div>
              <div className="floating-tag floating-tag--lime">GOOD BIT DETECTED ↗</div>
              <div className="floating-tag floating-tag--red">DEAD AIR: EJECTED</div>
            </div>
            <div className="visual-bottomline"><span>SUBJECT: YOUR BEST 20 SECONDS</span><span className="mono">EXPORT_READY: TRUE</span></div>
          </div>
        </div>

        <div className="pipeline-rail" id="pipeline">
          <div className="pipeline-rail-label"><span className="rail-pulse" /> SIGNAL PATH</div>
          {PIPELINE_STAGES.map((stage, i) => (
            <div key={stage.id} className="pipeline-step">
              <span className="pipeline-number">0{i + 1}</span>
              <span>{stage.label}</span>
              {i < PIPELINE_STAGES.length - 1 && <span className="pipeline-arrow" aria-hidden="true">→</span>}
            </div>
          ))}
        </div>
      </section>

      <Ticker items={TICKER_BOTTOM} reverse className="ticker ticker--bottom" />

      <section id="studio" className="studio-section">
        <div className="studio-heading">
          <SectionIndex number="01" label="INPUT / OUTPUT" />
          <div className="studio-heading-grid">
            <div>
              <h2 className="section-title">WELCOME TO<br /><span>THE EDIT BAY.</span></h2>
              <p className="section-intro">Drop a long video. Pull out the parts people actually watch. Try not to name the exported files “final_FINAL_v7”.</p>
            </div>
            <div className="bay-status">
              <div className="bay-status-head"><span className="eyebrow-dot" /> READY FOR SOURCE</div>
              <SignalBars />
              <div className="bay-status-foot"><span>INPUT SIGNAL</span><span>AWAITING FILE / URL</span></div>
            </div>
          </div>
        </div>

        <div className="studio-layout">
          <div className="tool-console">
            <div className="console-header">
              <div><span className="console-square" /> INGEST CONSOLE</div>
              <span className="console-id">UNIT 001 — SOURCE</span>
            </div>
            <div className="console-body">
              <CutForm />
            </div>
            <div className="console-footer"><span>SUPPORTED VIBE: PODCASTS / LECTURES / STREAMS</span><span>NO WATERMARK OUTPUT</span></div>
          </div>

          <aside className="systems-column" aria-label="How the clipper works">
            <article className="system-card system-card--dark">
              <div className="system-card-top"><span>SYS. 01</span><span className="system-status">LOCAL / CLOUD</span></div>
              <div className="system-card-title-row"><span className="system-glyph">⌘</span><h3>Choose your engine.</h3></div>
              <p>Run transcription locally to keep audio on your machine, or use Groq for a faster route with rate limits. Same pipeline. Different trade-offs.</p>
              <div className="mode-tags"><span>LOCAL = PRIVACY</span><span>GROQ = SPEED*</span></div>
              <small>*Speed is not immunity from rate limits. Sad but true.</small>
            </article>

            <article className="system-card system-card--lime">
              <div className="system-card-top"><span>SYS. 02</span><span className="system-status">FRAME / LOCK</span></div>
              <div className="system-card-title-row"><span className="system-glyph">⊹</span><h3>Keep the human in frame.</h3></div>
              <p>Vertical reframing follows the subject, so your speaker doesn’t become a tiny philosopher lost in a wide rectangle.</p>
              <div className="mini-frame" aria-hidden="true"><span /><span /><i /></div>
            </article>

            <article className="system-card system-card--paper">
              <div className="system-card-top"><span>SYS. 03</span><span className="system-status">WORD / SYNC</span></div>
              <div className="system-card-title-row"><span className="system-glyph">≋</span><h3>Captions with timing.</h3></div>
              <p>Burn in word-timed subtitles and keep export metadata alongside the output. Because “trust me bro” is not a file format.</p>
              <div className="caption-demo" aria-label="Example animated caption"><span>THAT&apos;S</span><strong>THE</strong><em>WHOLE POINT.</em></div>
            </article>
          </aside>
        </div>
      </section>

      <section className="closing-strip">
        <div className="closing-index"><span>END OF TRANSMISSION</span><span>CLIPPER / OPEN TOOLING</span></div>
        <p className="closing-title">LESS TIMELINE.<br /><span>MORE TIMING.</span></p>
        <figure className="founder-quote">
          <div className="founder-quote-mark" aria-hidden="true">“</div>
          <blockquote>I wasn’t built to wait for a seat at the table. I’m building the room.</blockquote>
          <figcaption><span className="founder-quote-line" /> FIELD NOTE / 001 — THE BUILDING PHASE</figcaption>
          <span className="founder-quote-coordinate" aria-hidden="true">NO PERMISSION REQUIRED</span>
        </figure>
        <div className="closing-footer"><span>BUILT FOR THE SCROLL, NOT FOR A TED TALK ABOUT THE SCROLL.</span><a href="#studio">RUN IT BACK ↗</a></div>
      </section>

      <footer className="site-footer">
        <a href="#top" className="footer-mark"><span className="wordmark-symbol">C<span>/</span></span> CLIPPER</a>
        <span>OPEN SOURCE · LOCAL-FIRST OPTIONS · ZERO WATERMARK NONSENSE</span>
        <span className="footer-coordinate">BROADCAST COMPLETE / 001</span>
      </footer>
    </main>
  );
}
