"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { HStack } from "@astryxdesign/core/HStack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

const PHONES = [
  {
    surfaceClass: "bg-surface border-info/40",
    caption: ["STOP", "SCROLLING", "FOR THIS"],
    active: 1,
    activeClass: "bg-info-muted text-info border border-info/50",
  },
  {
    surfaceClass: "bg-card border-accent-bg/60",
    caption: ["THE HOOK", "IS THE", "WHOLE CLIP"],
    active: 0,
    activeClass: "bg-accent-bg text-on-accent shadow-md",
  },
  {
    surfaceClass: "bg-surface border-success/40",
    caption: ["FACE STAYS", "IN FRAME", "WORDS POP"],
    active: 2,
    activeClass: "bg-success-muted text-success border border-success/50",
  },
] as const;

const SLOTS = [
  { x: 0, y: 0, r: 0, s: 1, z: 30, opacity: 1 },
  { x: 52, y: 18, r: 5, s: 0.9, z: 20, opacity: 0.82 },
  { x: -52, y: 18, r: -5, s: 0.9, z: 10, opacity: 0.72 },
] as const;

const WAVE_HEIGHTS = [
  "h-2",
  "h-5",
  "h-3",
  "h-7",
  "h-3",
  "h-6",
  "h-4",
  "h-7",
  "h-3",
  "h-5",
  "h-2",
  "h-6",
] as const;

export function PhoneStack() {
  const [front, setFront] = useState(1);

  return (
    <VStack
      width="100%"
      maxWidth={400}
      minHeight={420}
      className="relative mx-auto h-[380px] overflow-hidden md:h-[450px]"
    >
      {PHONES.map((phone, index) => {
        const slot = SLOTS[(index - front + PHONES.length) % PHONES.length];
        const isFront = index === front;

        return (
          <motion.button
            key={phone.caption.join(" ")}
            type="button"
            onClick={() => setFront(index)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") {
                e.preventDefault();
                setFront((prev) => (prev + 1) % PHONES.length);
              } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                setFront((prev) => (prev - 1 + PHONES.length) % PHONES.length);
              }
            }}
            aria-pressed={isFront}
            aria-label={`Preview vertical frame: ${phone.caption.join(" ")}`}
            animate={{
              x: `calc(-50% + ${slot.x}px)`,
              y: slot.y,
              rotate: slot.r,
              scale: slot.s,
              zIndex: slot.z,
              opacity: slot.opacity,
            }}
            transition={{ type: "spring", stiffness: 350, damping: 26 }}
            className={`absolute left-1/2 top-2 flex h-[340px] w-[195px] cursor-pointer flex-col justify-between overflow-hidden rounded-xl border-2 text-left shadow-lg focus-visible:outline-2 focus-visible:outline-offset-4 md:h-[420px] md:w-[230px] ${phone.surfaceClass}`}
          >
            <HStack
              paddingInline={3}
              paddingBlock={2}
              hAlign="between"
              vAlign="center"
              className="border-b border-border bg-muted/70"
            >
              <Text type="code" size="2xs" color="secondary" weight="semibold">
                9:16
              </Text>
              <HStack gap={1.5} vAlign="center">
                <StatusDot variant="success" label="1080p active" />
                <Text type="code" size="2xs" color="primary" weight="semibold">
                  1080p
                </Text>
              </HStack>
            </HStack>

            <VStack gap={1.5} padding={4} vAlign="end" className="flex-1">
              {phone.caption.map((word, wordIdx) => (
                <Text
                  key={word}
                  as="span"
                  display="block"
                  weight="bold"
                  className={`rounded-xs px-2 py-0.5 text-2xl tracking-tight transition-all md:text-3xl ${
                    wordIdx === phone.active ? phone.activeClass : "text-primary opacity-85"
                  }`}
                >
                  {word}
                </Text>
              ))}
            </VStack>

            <HStack
              gap={1}
              paddingInline={3}
              paddingBlock={2}
              vAlign="end"
              hAlign="between"
              aria-hidden="true"
              className="h-12 border-t border-border bg-muted/80"
            >
              {WAVE_HEIGHTS.map((heightClass, barIdx) => (
                <Text
                  key={barIdx}
                  as="span"
                  display="block"
                  className={`w-1.5 rounded-full ${heightClass} ${
                    barIdx % 3 === 0 ? "bg-info" : "bg-accent-bg"
                  }`}
                >
                  {" "}
                </Text>
              ))}
            </HStack>
          </motion.button>
        );
      })}
    </VStack>
  );
}
