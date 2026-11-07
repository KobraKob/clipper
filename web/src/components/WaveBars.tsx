"use client";

const HEIGHTS = [28, 72, 44, 90, 36, 80, 52, 96, 40, 68, 24, 84, 48, 76, 32, 88];

const LIVE_CSS = `
@keyframes wavebars-bounce { 0%, 100% { transform: scaleY(.25); } 50% { transform: scaleY(1); } }
.wavebars-live { transform-origin: bottom; animation: wavebars-bounce 1.1s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .wavebars-live { animation: none; } }
`;

export function WaveBars({ live = false }: { live?: boolean }) {
  return (
    <>
      {live ? <style>{LIVE_CSS}</style> : null}
      <div
        className="grid h-16 items-end gap-1 overflow-hidden rounded-xl border border-white/[0.08] bg-[#07090e] p-2.5 shadow-inner"
        style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}
        aria-hidden="true"
      >
        {HEIGHTS.map((height, index) => (
          <span
            key={index}
            className={`block w-full rounded-full transition-opacity duration-300 ${
              index % 4 === 0 ? "bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.4)]" : "bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.3)]"
            } ${live ? "wavebars-live" : "opacity-40"}`}
            style={{
              height: `${height}%`,
              animationDelay: live ? `${index * 65}ms` : undefined,
              animationDuration: live ? `${0.85 + (index % 4) * 0.15}s` : undefined,
            }}
          />
        ))}
      </div>
    </>
  );
}
