/** Mirrors clipper/captions.py CAPTION_STYLES. Keep keys synchronized with backend presets. */
export type CaptionCategory = "bold" | "minimal" | "creative";

export type CaptionStyleOption = {
  key: string;
  label: string;
  description: string;
  font: string;
  upper: boolean;
  base: string;
  active: string;
  activeBg?: string;
  stroke: string;
  glow?: string;
  category: CaptionCategory;
};

export const CAPTION_STYLE_OPTIONS: CaptionStyleOption[] = [
  { key: "bold_pop", label: "Bold Pop", description: "Big uppercase words. Spoken word turns yellow and pops.", font: "800 22px system-ui", upper: true, base: "#fff", active: "#ffe600", stroke: "#000", category: "bold" },
  { key: "beast", label: "Beast Impact", description: "Chunky comic type with a thick outline and green flash.", font: "900 24px Impact, system-ui", upper: true, base: "#fff", active: "#39ff14", stroke: "#000", category: "bold" },
  { key: "one_word", label: "One Word", description: "One huge word at a time, centred for maximum impact.", font: "900 28px Impact, system-ui", upper: true, base: "#fff", active: "#fff", stroke: "#000", category: "bold" },
  { key: "highlight_box", label: "Highlight Box", description: "The spoken word sits on a solid yellow block.", font: "800 20px system-ui", upper: true, base: "#fff", active: "#000", activeBg: "#ffe600", stroke: "#000", category: "bold" },
  { key: "neon", label: "Neon Glow", description: "Condensed type with vivid pink and cyan glow.", font: "700 26px Impact, system-ui", upper: true, base: "#fff", active: "#ff2bd6", stroke: "#00e5ff", glow: "#00e5ff", category: "creative" },
  { key: "karaoke", label: "Karaoke Fill", description: "Words fill with colour as they are spoken.", font: "800 20px system-ui", upper: true, base: "#fff", active: "#00c2ff", stroke: "#000", category: "creative" },
  { key: "clean", label: "Clean Minimal", description: "Sentence-case subtitles with a soft shadow. Calm and premium.", font: "600 17px system-ui", upper: false, base: "#fff", active: "#fff", stroke: "#000", category: "minimal" },
  { key: "mint_pop", label: "Mint Pop", description: "A soft mint highlight with a quick pop. Bright, not shouty.", font: "800 21px system-ui", upper: true, base: "#f4fff8", active: "#9cffbd", stroke: "#173d2b", category: "creative" },
  { key: "creator_block", label: "Creator Block", description: "Vivid cyan block behind the spoken word, with clean heavy type.", font: "800 20px system-ui", upper: true, base: "#f5faff", active: "#07121b", activeBg: "#00e5ff", stroke: "#07121b", category: "bold" },
  { key: "retro_wave", label: "Retro Wave", description: "Condensed retro type with magenta glow and warm emphasis.", font: "800 24px Impact, system-ui", upper: true, base: "#fff3e8", active: "#ff9d3d", stroke: "#321a2b", glow: "#ff3d81", category: "creative" },
  { key: "editorial", label: "Editorial", description: "Understated sentence-case captions with cool blue emphasis.", font: "600 17px system-ui", upper: false, base: "#e8eeff", active: "#7295ff", stroke: "#000", category: "minimal" },
  { key: "typewriter", label: "Typewriter", description: "Monospaced mint karaoke for tutorials, coding, and explainers.", font: "600 16px ui-monospace, monospace", upper: false, base: "#95ffd8", active: "#fff", stroke: "#081712", category: "creative" },
  { key: "sunset", label: "Sunset Punch", description: "Warm orange emphasis and strong outlines for high-energy stories.", font: "900 25px Impact, system-ui", upper: true, base: "#fff7ef", active: "#ffb45c", stroke: "#321a2b", category: "bold" },
];
