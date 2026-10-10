const PHONES = [
  {
    bg: "bg-court",
    fg: "text-volt",
    caption: ["STOP", "SCROLLING", "FOR THIS"],
    active: 1,
    rotate: "-rotate-6",
    offset: "left-2 top-10 hidden sm:block",
  },
  {
    bg: "bg-volt",
    fg: "text-ink",
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
          className={`absolute ${phone.offset} ${phone.rotate} h-[340px] w-[190px] border-4 border-ink ${phone.bg} stamp-sm md:h-[440px] md:w-[230px]`}
        >
          <div className="flex h-8 items-center justify-between border-b-4 border-ink px-2 text-[10px] font-bold">
            <span>9:16</span>
            <span>1080</span>
          </div>
          <div className={`flex h-[calc(100%-5.5rem)] flex-col justify-end gap-1 p-3 ${phone.fg}`}>
            {phone.caption.map((word, index) => (
              <p
                key={word}
                className={`display text-4xl md:text-5xl ${
                  index === phone.active ? "bg-ink px-1 text-volt" : ""
                }`}
              >
                {word}
              </p>
            ))}
          </div>
          <div className="grid h-14 grid-cols-12 items-end gap-px border-t-4 border-ink bg-ink p-2">
            {Array.from({ length: 12 }, (_, i) => (
              <span
                key={i}
                className={`block w-full ${i % 3 === 0 ? "bg-volt" : "bg-ice"}`}
                style={{ height: `${30 + ((i * 17) % 70)}%` }}
              />
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
