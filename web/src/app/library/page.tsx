import Link from "next/link";
import { LibraryGrid } from "@/components/LibraryGrid";

export default function LibraryPage() {
  return (
    <main className="app-page library-page">
      <div className="page-topline">
        <nav aria-label="Breadcrumb" className="page-breadcrumb">
          <Link href="/">Studio</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Library</span>
        </nav>
        <span>WORKSPACE / 01</span>
      </div>

      <header className="page-header">
        <div>
          <p className="home-section-kicker">YOUR PROJECTS</p>
          <h1 className="page-title">The library<span>.</span></h1>
          <p className="page-description">
            Search your projects, check processing status, and reopen a cut.
            Finished clips stay attached to the job they came from.
          </p>
        </div>
        <div className="page-actions">
          <Link className="page-action" href="/calendar">Publishing calendar ↗</Link>
          <Link className="page-action page-action-primary" href="/#studio">Create a cut ↗</Link>
        </div>
      </header>

      <section aria-label="Saved projects">
        <LibraryGrid />
      </section>
    </main>
  );
}
