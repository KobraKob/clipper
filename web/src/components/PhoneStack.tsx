const PHONES = [
  {
    bg: "bg-panel-raised",
    fg: "text-volt",
    caption: ["STOP", "SCROLLING", "FOR THIS"],
    active: 1,
    rotate: "-rotate-6",
    offset: "left-2 top-10 hidden sm:block",
  },
  {
    bg: "bg-volt",
    fg: "text-[#101016]",
    caption: ["THE HOOK", "IS THE", "WHOLE CLIP"],
    active: 0,
    rotate: "rotate-0",
    offset: "left-1/2 top-0 -translate-x-1/2 z-10",
  },
  {
    bg: "bg-punch",
    fg: "text-white",
    caption: ["FACE STAYS", "IN FRAME", "WORDS POP"],
    active: 2,
    rotate: "rotate-6",
    offset: "right-2 top-12 hidden sm:block",
  },
];

export function PhoneStack() {
  return (
    <div className="relative mx-auto h-[400px] w-full max-w-[340px] overflow-hidden md:h-[500px] md:max-w-[400px]">
      {PHONES.map((phone) => (
        <article
          key={phone.caption.join(" ")}
          className={`absolute ${phone.offset} ${phone.rotate} h-[340px] w-[190px] border-2 border-white/20 ${phone.bg} stamp-sm rounded-2xl overflow-hidden md:h-[440px] md:w-[230px]`}
        >
          <div className="flex h-8 items-center justify-between border-b border-white/15 px-3 text-[10px] font-bold opacity-80">
            <span>9:16</span>
            <span>1080</span>
          </div>
          <div className={`flex h-[calc(100%-5.5rem)] flex-col justify-end gap-1 p-3.5 ${phone.fg}`}>
            {phone.caption.map((word, index) => (
              <p
                key={word}
                className={`display text-3xl md:text-5xl ${
                  index === phone.active ? "bg-[#101016] px-1.5 py-0.5 text-volt rounded" : ""
                }`}
              >
                {word}
              </p>
            ))}
          </div>
          <div className="grid h-14 grid-cols-12 items-end gap-0.5 border-t border-white/15 bg-panel-inset p-2">
            {Array.from({ length: 12 }, (_, i) => (
              <span
                key={i}
                className={`block w-full rounded-xs ${i % 3 === 0 ? "bg-volt" : "bg-ice"}`}
                style={{ height: `${30 + ((i * 17) % 70)}%` }}
              />
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
