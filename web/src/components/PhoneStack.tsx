"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";

const PHONES = [
  {
    bg: "bg-[#111420]",
    fg: "text-cyan-300",
    border: "border-cyan-500/30",
    caption: ["STOP", "SCROLLING", "FOR THIS"],
    active: 1,
    activeBg: "bg-cyan-950/80 text-cyan-300 border border-cyan-400/40",
  },
  {
    bg: "bg-gradient-to-br from-indigo-600 via-indigo-700 to-indigo-900",
    fg: "text-white",
    border: "border-indigo-400/40",
    caption: ["THE HOOK", "IS THE", "WHOLE CLIP"],
    active: 0,
    activeBg: "bg-black/60 text-indigo-200 border border-indigo-400/50 shadow-md",
  },
  {
    bg: "bg-gradient-to-br from-emerald-600 via-teal-800 to-slate-900",
    fg: "text-white",
    border: "border-emerald-400/30",
    caption: ["FACE STAYS", "IN FRAME", "WORDS POP"],
    active: 2,
    activeBg: "bg-black/60 text-emerald-300 border border-emerald-400/40 shadow-md",
  },
];

// slot 0 = front, 1 = right, 2 = left. x is a percentage of the phone's own width.
const SLOTS = [
  { x: 0, y: 0, r: 0, s: 1, z: 30, opacity: 1 },
  { x: 44, y: 24, r: 5, s: 0.9, z: 20, opacity: 0.8 },
  { x: -44, y: 24, r: -5, s: 0.9, z: 10, opacity: 0.7 },
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
          <motion.button
            key={phone.caption.join(" ")}
            type="button"
            onClick={() => bringForward(index)}
            aria-pressed={isFront}
            aria-label={`Preview: ${phone.caption.join(" ")}`}
            animate={{
              x: `calc(-50% + ${slot.x * 1.8}px)`,
              y: slot.y,
              rotate: slot.r,
              scale: slot.s,
              zIndex: slot.z,
              opacity: slot.opacity,
            }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            className={`absolute left-1/2 top-2 block h-[340px] w-[190px] cursor-pointer overflow-hidden rounded-3xl border ${phone.border} text-left shadow-2xl backdrop-blur-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500 md:h-[440px] md:w-[230px] ${phone.bg}`}
          >
            <span className={`flex h-8 items-center justify-between border-b border-white/10 px-3.5 text-[10px] font-bold opacity-80 ${phone.fg}`}>
              <span className="font-mono">9:16</span>
              <span className="flex items-center gap-1 font-mono">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                1080p
              </span>
            </span>

            <span className={`flex h-[calc(100%-5.5rem)] flex-col justify-end gap-1.5 p-4 ${phone.fg}`}>
              {phone.caption.map((word, i) => (
                <span
                  key={word}
                  className={`font-display block -ml-1 self-start rounded-md px-2 py-0.5 text-2xl md:text-4xl transition-all duration-200 tracking-tight ${
                    i === activeWord ? phone.activeBg : "opacity-85"
                  }`}
                >
                  {word}
                </span>
              ))}
            </span>

            <span className="grid h-12 grid-cols-12 items-end gap-1 border-t border-white/10 bg-black/40 p-2.5" aria-hidden="true">
              {Array.from({ length: 12 }, (_, i) => (
                <span
                  key={i}
                  className={`block w-full rounded-full ${i % 3 === 0 ? "bg-cyan-400" : "bg-indigo-400"}`}
                  style={{ height: `${25 + ((i * 19) % 75)}%` }}
                />
              ))}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
