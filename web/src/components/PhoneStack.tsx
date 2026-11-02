"use client";

import { useEffect, useState } from "react";

const PHONES = [
  { bg: "bg-panel-raised", fg: "text-volt", caption: ["STOP", "SCROLLING", "FOR THIS"], active: 1 },
  { bg: "bg-volt", fg: "text-[#101016]", caption: ["THE HOOK", "IS THE", "WHOLE CLIP"], active: 0 },
  { bg: "bg-punch", fg: "text-white", caption: ["FACE STAYS", "IN FRAME", "WORDS POP"], active: 2 },
];

// slot 0 = front, 1 = right, 2 = left. x is a percentage of the phone's own width.
const SLOTS = [
  { x: 0, y: 0, r: 0, s: 1, z: 30 },
  { x: 46, y: 28, r: 6, s: 0.9, z: 20 },
  { x: -46, y: 28, r: -6, s: 0.9, z: 10 },
];

export function PhoneStack() {
  const [front, setFront] = useState(1);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    }, 650);
    return () => window.clearInterval(id);
  }, []);

  function bringForward(index: number) {
    setFront(index);
    setTick(0);
  }

  return (
    <div className="relative mx-auto h-[400px] w-full max-w-[340px] overflow-hidden md:h-[500px] md:max-w-[400px]">
      {PHONES.map((phone, index) => {
        const slot = SLOTS[(index - front + PHONES.length) % PHONES.length];
        const isFront = index === front;
        const activeWord = isFront ? tick % phone.caption.length : phone.active;

        return (
          <button
            key={phone.caption.join(" ")}
            type="button"
            onClick={() => bringForward(index)}
            aria-pressed={isFront}
            aria-label={`Preview: ${phone.caption.join(" ")}`}
            className={`stamp-sm absolute left-1/2 top-2 block h-[340px] w-[190px] cursor-pointer overflow-hidden rounded-2xl border-2 border-white/20 text-left transition-transform duration-300 ease-out focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ice motion-reduce:transition-none md:h-[440px] md:w-[230px] ${phone.bg}`}
            style={{
              zIndex: slot.z,
              transform: `translateX(${-50 + slot.x}%) translateY(${slot.y}px) rotate(${slot.r}deg) scale(${slot.s})`,
            }}
          >
            <span className={`flex h-8 items-center justify-between border-b border-white/15 px-3 text-[10px] font-bold opacity-80 ${phone.fg}`}>
              <span>9:16</span>
              <span>1080</span>
            </span>

            <span className={`flex h-[calc(100%-5.5rem)] flex-col justify-end gap-1 p-3.5 ${phone.fg}`}>
              {phone.caption.map((word, i) => (
                <span
                  key={word}
                  className={`display block -ml-1.5 self-start rounded px-1.5 py-0.5 text-3xl transition-colors duration-150 md:text-5xl ${
                    i === activeWord ? "bg-[#101016] text-volt" : ""
                  }`}
                >
                  {word}
                </span>
              ))}
            </span>

            <span className="grid h-14 grid-cols-12 items-end gap-0.5 border-t border-white/15 bg-panel-inset p-2" aria-hidden="true">
              {Array.from({ length: 12 }, (_, i) => (
                <span
                  key={i}
                  className={`block w-full rounded-xs ${i % 3 === 0 ? "bg-volt" : "bg-ice"}`}
                  style={{ height: `${30 + ((i * 17) % 70)}%` }}
                />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}