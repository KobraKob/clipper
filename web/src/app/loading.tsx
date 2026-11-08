export default function Loading() {
  return (
    <section aria-busy="true" aria-label="Loading Chop Shop" className="mx-auto min-h-[65vh] w-full max-w-[1360px] px-4 py-10 sm:px-6 lg:px-8">
      <div role="status" className="sr-only">Loading page content</div>
      <div className="animate-pulse">
        <div className="h-3 w-28 rounded bg-white/10" />
        <div className="mt-5 h-10 w-2/3 max-w-xl rounded-lg bg-white/10" />
        <div className="mt-3 h-4 w-full max-w-lg rounded bg-white/[0.07]" />
        <div className="mt-2 h-4 w-4/5 max-w-md rounded bg-white/[0.07]" />
        <div className="mt-9 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="overflow-hidden rounded-xl border border-white/10 bg-panel">
              <div className="aspect-[16/7] bg-white/[0.07]" />
              <div className="space-y-3 p-4">
                <div className="h-3 w-1/3 rounded bg-white/10" />
                <div className="h-5 w-4/5 rounded bg-white/10" />
                <div className="h-3 w-1/2 rounded bg-white/[0.07]" />
                <div className="mt-4 h-9 w-full rounded-lg bg-white/[0.07]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
