import { CutForm } from "@/components/CutForm";
import { PhoneStack } from "@/components/PhoneStack";
import { PIPELINE_STAGES } from "@/lib/types";

export default function Home() {
  return (
    <main>
      <section className="relative border-b-4 border-court bg-court text-volt">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)] md:px-6 md:py-16">
          <div>
            <p className="font-semibold">Podcasts, lectures, streams</p>
            <h1 className="display mt-3 text-7xl md:text-8xl lg:text-[7.5rem]">
              Punch vertical clips out of a long take.
            </h1>
            <p className="mt-6 max-w-lg text-lg text-white">
              Same path as the Python pipeline: ingest, transcribe, window, rank, cut, reframe,
              captions. You drop the source. We keep the speaker in frame and the hook in the first
              three seconds.
            </p>
          </div>
          <PhoneStack />
        </div>
        <div className="flex flex-wrap border-t-4 border-volt">
          {PIPELINE_STAGES.map((stage) => (
            <p
              key={stage.id}
              className="flex-1 border-volt px-3 py-2 text-sm font-semibold text-volt md:border-r-4 md:last:border-r-0"
            >
              {stage.label}
            </p>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:px-6">
        <CutForm />
        <aside className="flex flex-col gap-4">
          <div className="border-4 border-court bg-volt p-5 stamp">
            <p className="display text-4xl text-ink">Why the floor looks like this</p>
            <p className="mt-3 max-w-sm">
              Short-form is a contact sport. Hard blocks, tally-light yellow, and a 9:16 stack —
              not a washed dashboard.
            </p>
          </div>
          <div className="border-4 border-court bg-white p-5">
            <p className="display text-3xl text-court">Local or Groq</p>
            <p className="mt-2">
              Local keeps audio on the machine. Groq is fast and rate-limited. Flip the same switch
              the backend already reads from env.
            </p>
          </div>
          <div className="border-4 border-court bg-punch p-5 text-white">
            <p className="display text-3xl">Captions hit like a lower-third</p>
            <p className="mt-2">
              Word-timed burn-in, face-tracked crop, metadata beside every export. MP4s attach once
              cut/reframe write files.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
