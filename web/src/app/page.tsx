"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { CutForm } from "@/components/CutForm";
import { PhoneStack } from "@/components/PhoneStack";
import { PIPELINE_STAGES } from "@/lib/types";

const STAGE_DESCRIPTIONS: Record<string, string> = {
  ingest: "Stream or import raw footage locally without compression loss.",
  transcribe: "Whisper AI speech-to-text generating word-level timestamps.",
  analyze: "Semantic hook scoring and attention retention analytics.",
  rank: "Deduplication and smart ranking of viral segment candidates.",
  cut: "Lossless frame-accurate trimming across selected timestamps.",
  face_track: "Active-speaker intelligent framing for 9:16 vertical viewports.",
  caption: "Styled kinetic subtitles with animated karaoke word pop.",
  export: "Multi-platform export ready for TikTok, Shorts & Reels.",
};

const STATS = [
  { value: "9:16", label: "Smart Vertical Re-frame" },
  { value: "< 60s", label: "Viral Hook Detection" },
  { value: "100%", label: "Local-First Privacy" },
  { value: "0", label: "Watermarks or Limits" },
];

export default function Home() {
  return (
    <div className="home-page selection:bg-indigo-600 selection:text-white">
      {/* Hero Section */}
      <section className="relative overflow-hidden pt-6 pb-16 lg:py-20" aria-labelledby="home-title">
        {/* Subtle Ambient Background Gradients */}
        <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-gradient-to-b from-indigo-600/15 via-cyan-500/10 to-transparent blur-3xl -z-10" />

        <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
            {/* Left Copy Column */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-7 flex flex-col gap-6"
            >
              <div className="inline-flex items-center gap-2.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-300 w-fit shadow-sm shadow-indigo-500/10">
                <span className="flex h-2 w-2 rounded-full bg-indigo-400 animate-pulse" />
                <span>Next-Gen Video Clipping Studio</span>
              </div>

              <h1 id="home-title" className="font-display text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight uppercase leading-[0.92]">
                <span className="block text-white">Find the moment.</span>
                <span className="block bg-gradient-to-r from-indigo-400 via-cyan-300 to-indigo-200 bg-clip-text text-transparent">
                  Make the cut.
                </span>
              </h1>

              <p className="text-base sm:text-lg text-slate-300 max-w-2xl leading-relaxed">
                Transform hours of podcasts, streams, and interviews into high-converting vertical shorts. AI-powered hook discovery, dynamic speaker tracking, animated captions, and instant multi-platform scheduling.
              </p>

              {/* CTAs */}
              <div className="flex flex-wrap items-center gap-4 pt-2">
                <motion.a
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  href="#studio"
                  className="inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 px-6 py-3.5 text-sm font-semibold text-white shadow-xl shadow-indigo-500/30 hover:shadow-indigo-500/50 hover:brightness-110 transition-all"
                >
                  <span>Start New Project</span>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </motion.a>

                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Link
                    href="/library"
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-6 py-3.5 text-sm font-semibold text-slate-200 hover:bg-white/[0.08] hover:text-white hover:border-white/20 transition-all"
                  >
                    <span>View Library</span>
                    <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </Link>
                </motion.div>
              </div>

              {/* Stats Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-6 border-t border-white/[0.08]">
                {STATS.map((stat) => (
                  <div key={stat.label} className="flex flex-col">
                    <span className="font-display text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                      {stat.value}
                    </span>
                    <span className="text-xs text-slate-400 font-medium">{stat.label}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Right Visual Interactive Phone Stack */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-5 flex flex-col items-center justify-center relative"
            >
              <div className="relative w-full max-w-[380px] p-4 rounded-3xl bg-gradient-to-b from-white/[0.08] to-white/[0.02] border border-white/[0.1] shadow-2xl shadow-indigo-950/50 backdrop-blur-md">
                <div className="flex items-center justify-between pb-3 px-2 border-b border-white/[0.06] text-xs text-slate-400">
                  <span className="flex items-center gap-1.5 font-medium text-slate-300">
                    <span className="h-2 w-2 rounded-full bg-cyan-400" />
                    Interactive Vertical Preview
                  </span>
                  <span className="font-mono text-[11px] text-indigo-400">1080 × 1920</span>
                </div>

                <div className="pt-2">
                  <PhoneStack />
                </div>

                <div className="mt-3 p-3 rounded-xl bg-[#090b10] border border-white/[0.06] flex items-center justify-between text-xs">
                  <span className="text-slate-400">Speaker Framing</span>
                  <span className="text-emerald-400 font-semibold flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Auto Active
                  </span>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Main Studio / Video Creation Form Section */}
      <section id="studio" className="py-12 sm:py-16 scroll-mt-20 border-t border-white/[0.08]">
        <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8">
          {/* Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-indigo-400 mb-1">
                Project Studio
              </p>
              <h2 className="font-display text-3xl sm:text-4xl font-extrabold uppercase tracking-tight text-white">
                Initialize Video Pipeline
              </h2>
            </div>
            <p className="text-sm text-slate-400 max-w-md">
              Enter any YouTube URL, paste a direct media link, or upload local video footage to begin automatic AI extraction.
            </p>
          </div>

          {/* Form Card Container */}
          <div className="rounded-3xl border border-white/[0.1] bg-[#0c0e15]/90 p-5 sm:p-8 shadow-2xl backdrop-blur-xl">
            <CutForm />
          </div>
        </div>
      </section>

      {/* Process Pipeline Overview Section */}
      <section id="pipeline" className="py-16 sm:py-20 border-t border-white/[0.08] bg-[#07080c]/60">
        <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="text-xs font-bold uppercase tracking-widest text-cyan-400 mb-2">
              Autonomous Architecture
            </p>
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold uppercase tracking-tight text-white mb-3">
              How the Cutting Engine Works
            </h2>
            <p className="text-sm sm:text-base text-slate-400">
              Each raw video travels through eight discrete, deterministic processing stages to guarantee broadcast-level results.
            </p>
          </div>

          {/* Stages Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {PIPELINE_STAGES.map((stage, idx) => (
              <motion.div
                key={stage.id}
                whileHover={{ y: -4 }}
                transition={{ duration: 0.2 }}
                className="group relative rounded-2xl border border-white/[0.08] bg-[#0d1018] p-5 hover:border-indigo-500/40 hover:bg-[#121622] transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="font-display text-sm font-bold text-slate-500 group-hover:text-cyan-400 transition-colors">
                    0{idx + 1}
                  </span>
                  <span className="h-2 w-2 rounded-full bg-slate-700 group-hover:bg-indigo-400 transition-colors" />
                </div>
                <h3 className="text-base font-bold text-white mb-1.5 group-hover:text-indigo-200 transition-colors">
                  {stage.label}
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {STAGE_DESCRIPTIONS[stage.id] || "Automated processing stage"}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
