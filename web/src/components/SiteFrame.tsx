"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";

const NAV_ITEMS = [
  { href: "/", label: "Studio", match: (p: string) => p === "/" },
  { href: "/#pipeline", label: "Pipeline", match: () => false },
  { href: "/library", label: "Library", match: (p: string) => p.startsWith("/library") || p.startsWith("/jobs") },
  { href: "/calendar", label: "Calendar", match: (p: string) => p.startsWith("/calendar") },
];

export function SiteFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-full flex flex-col bg-paper text-ink relative selection:bg-indigo-600 selection:text-white">
      {/* Accessibility Skip Link */}
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-indigo-600 focus:px-4 focus:py-2 focus:font-semibold focus:text-white focus:shadow-lg focus:outline-none"
      >
        Skip to main content
      </a>

      {/* Top Ambient Glow Backdrop */}
      <div
        className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[900px] h-[340px] bg-gradient-to-b from-indigo-500/10 via-cyan-500/5 to-transparent blur-xl z-0"
        aria-hidden="true"
      />

      {/* Modern Sticky Navigation Bar */}
      <header className="sticky top-0 z-50 w-full border-b border-white/[0.08] bg-[#08090d]/90 backdrop-blur-sm transition-colors duration-200">
        <div className="mx-auto flex h-[72px] w-full max-w-[1360px] items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Brand Logo */}
          <Link
            href="/"
            aria-label="Chop Shop home"
            className="group flex shrink-0 items-center gap-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg p-1"
          >
            <motion.div
              whileHover={{ scale: 1.05, rotate: 2 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 shadow-md shadow-indigo-500/25 ring-1 ring-white/20"
            >
              <span className="font-display text-sm font-black tracking-wider text-white">CS</span>
            </motion.div>
            <div className="flex flex-col">
              <span className="font-display text-xl font-extrabold tracking-tight text-white group-hover:text-indigo-200 transition-colors">
                CHOP SHOP
              </span>
              <span className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
                AI Cut Room
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav aria-label="Main navigation" className="hidden md:flex items-center gap-1.5">
            {NAV_ITEMS.map((item) => {
              const isActive = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`relative px-4 py-2 text-sm font-medium transition-all duration-200 rounded-full ${
                    isActive
                      ? "text-white font-semibold"
                      : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]"
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="active-nav-pill"
                      className="absolute inset-0 rounded-full bg-gradient-to-r from-indigo-500/20 to-cyan-500/20 border border-indigo-500/40 shadow-sm"
                      transition={{ type: "spring", stiffness: 450, damping: 30 }}
                    />
                  )}
                  <span className="relative z-10">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Right Action Area */}
          <div className="hidden sm:flex items-center gap-3.5">
            {/* Live Indicator */}
            <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-slate-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="font-medium">Local-first Engine</span>
            </div>

            {/* Quick Action Button */}
            <Link
              href="/#studio"
              className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              <span>New Cut</span>
            </Link>
          </div>

          {/* Mobile Menu Trigger Button */}
          <div className="flex md:hidden items-center gap-2">
            <Link
              href="/#studio"
              className="rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-indigo-600/30"
            >
              + Cut
            </Link>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-slate-300 hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="border-b border-white/[0.08] bg-[#0c0e14] px-4 py-4 md:hidden overflow-hidden"
            >
              <div className="flex flex-col gap-2">
                {NAV_ITEMS.map((item) => {
                  const isActive = item.match(pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 font-semibold"
                          : "text-slate-300 hover:bg-white/[0.04] hover:text-white"
                      }`}
                    >
                      <span>{item.label}</span>
                      {isActive && <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />}
                    </Link>
                  );
                })}
              </div>

              <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
                  Local-first Engine Ready
                </span>
                <span className="text-slate-500">v2.1</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Main Page Content Body */}
      <main id="content" tabIndex={-1} className="flex-1 outline-none relative z-10">
        {children}
      </main>

      {/* Unified Modern App Footer */}
      <footer className="mt-auto border-t border-white/[0.08] bg-[#06070a]/90 backdrop-blur-md py-8 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1360px] flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <span className="font-display text-sm font-bold tracking-tight text-slate-300">CHOP SHOP</span>
            <span className="text-slate-600">/</span>
            <span>Intelligent vertical video cut room & clipping studio</span>
          </div>

          <div className="flex items-center gap-6">
            <Link href="/" className="hover:text-slate-300 transition-colors">Studio</Link>
            <Link href="/library" className="hover:text-slate-300 transition-colors">Library</Link>
            <Link href="/calendar" className="hover:text-slate-300 transition-colors">Calendar</Link>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400 font-mono">100% Client & Local Precision</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
