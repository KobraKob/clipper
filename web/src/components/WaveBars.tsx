const HEIGHTS = [28, 72, 44, 90, 36, 80, 52, 96, 40, 68, 24, 84, 48, 76, 32, 88];

const LIVE_CSS = `
@keyframes wavebars-bounce { 0%, 100% { transform: scaleY(.3); } 50% { transform: scaleY(1); } }
.wavebars-live { transform-origin: bottom; animation: wavebars-bounce 1.1s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .wavebars-live { animation: none; } }
`;

export function WaveBars({ live = false }: { live?: boolean }) {
  return (
    <>
      {live ? <style>{LIVE_CSS}</style> : null}
      <div
        className="grid h-16 items-end gap-1.5 overflow-hidden rounded-lg border border-white/10 bg-panel-inset p-2.5"
        style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}
        aria-hidden="true"
      >
        {HEIGHTS.map((height, index) => (
          <span
            key={index}
            className={`block w-full rounded-xs ${index % 4 === 0 ? "bg-ice" : "bg-volt"} ${
              live ? "wavebars-live" : "opacity-60"
            }`}
            style={{
              height: `${height}%`,
              animationDelay: live ? `${index * 70}ms` : undefined,
              animationDuration: live ? `${0.9 + (index % 4) * 0.15}s` : undefined,
            }}
          />
        ))}
      </div>
    </>
  );
}