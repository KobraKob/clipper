const HEIGHTS = [28, 72, 44, 90, 36, 80, 52, 96, 40, 68, 24, 84, 48, 76, 32, 88];

export function WaveBars({ live = false }: { live?: boolean }) {
  return (
    <div
      className="grid h-16 items-end gap-1.5 bg-panel-inset border border-white/10 rounded-lg p-2.5 overflow-hidden"
      style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}
      aria-hidden
    >
      {HEIGHTS.map((height, index) => (
        <span
          key={index}
          className={`block w-full rounded-xs ${index % 4 === 0 ? "bg-punch" : "bg-volt"} ${
            live ? "origin-bottom animate-pulse" : "opacity-80"
          }`}
          style={{ height: `${height}%`, animationDelay: `${index * 40}ms` }}
        />
      ))}
    </div>
  );
}
