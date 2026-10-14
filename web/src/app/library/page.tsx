import { LibraryGrid } from "@/components/LibraryGrid";

export default function LibraryPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 md:px-6">
      <h1 className="display text-6xl md:text-7xl text-ink">Library</h1>
      <p className="mt-3 mb-8 max-w-xl text-muted text-base md:text-lg">
        Every job the studio has run on this machine. Open one to keep, drop, or retimecode clips.
      </p>
      <LibraryGrid />
    </main>
  );
}
