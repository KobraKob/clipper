const HEIGHTS = [28, 72, 44, 90, 36, 80, 52, 96, 40, 68, 24, 84, 48, 76, 32, 88];

export function WaveBars({ live = false }: { live?: boolean }) {
  return (
    <div
      className="grid h-16 items-end gap-1 bg-ink p-2"
      style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}
      aria-hidden
    >
      {HEIGHTS.map((height, index) => (
        <span
          key={index}
          className={`block w-full ${index % 4 === 0 ? "bg-punch" : "bg-volt"} ${
            live ? "origin-bottom animate-pulse" : ""
          }`}
          style={{ height: `${height}%`, animationDelay: `${index * 40}ms` }}
        />
      ))}
    </div>
  );
}
