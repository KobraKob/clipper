/** Mirrors clipper/captions.py CAPTION_STYLES (keys must match). Used for the picker preview only. */
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
};

export const CAPTION_STYLE_OPTIONS: CaptionStyleOption[] = [
  { key: "bold_pop", label: "Bold Pop", description: "Uppercase words, the spoken one turns yellow and pops.", font: "800 22px system-ui", upper: true, base: "#fff", active: "#ffe600", stroke: "#000" },
  { key: "beast", label: "Beast Impact", description: "Chunky comic font, thick outline, green flash.", font: "900 24px Impact, system-ui", upper: true, base: "#fff", active: "#39ff14", stroke: "#000" },
  { key: "one_word", label: "One Word", description: "One huge word at a time, centred.", font: "900 28px Impact, system-ui", upper: true, base: "#fff", active: "#fff", stroke: "#000" },
  { key: "highlight_box", label: "Highlight Box", description: "Spoken word sits on a yellow block.", font: "800 20px system-ui", upper: true, base: "#fff", active: "#000", activeBg: "#ffe600", stroke: "#000" },
  { key: "neon", label: "Neon Glow", description: "Condensed type, glowing pink word.", font: "700 26px Impact, system-ui", upper: true, base: "#fff", active: "#ff2bd6", stroke: "#00e5ff" },
  { key: "karaoke", label: "Karaoke Fill", description: "Words fill with colour as spoken.", font: "800 20px system-ui", upper: true, base: "#fff", active: "#00c2ff", stroke: "#000" },
  { key: "clean", label: "Clean Minimal", description: "Sentence-case, calm, premium.", font: "600 17px system-ui", upper: false, base: "#fff", active: "#fff", stroke: "#000" },
];
