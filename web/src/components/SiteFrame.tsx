"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const NAV_ITEMS = [
  { href: "/", label: "Studio", match: (p: string) => p === "/" },
  { href: "/#pipeline", label: "Pipeline", match: () => false },
  { href: "/library", label: "Library", match: (p: string) => p.startsWith("/library") || p.startsWith("/jobs") },
  { href: "/calendar", label: "Calendar", match: (p: string) => p.startsWith("/calendar") },
];

export function SiteFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [connectionState, setConnectionState] = useState<"offline" | "online" | null>(null);
  const [storageNoticeOpen, setStorageNoticeOpen] = useState(false);

  useEffect(() => {
    try {
      setStorageNoticeOpen(
        window.localStorage.getItem("chop-shop-storage-notice-v1") !== "acknowledged",
      );
    } catch {
      setStorageNoticeOpen(false);
    }

    let onlineTimer: number | undefined;
    const handleOffline = () => {
      if (onlineTimer !== undefined) window.clearTimeout(onlineTimer);
      setConnectionState("offline");
    };
    const handleOnline = () => {
      setConnectionState("online");
      if (onlineTimer !== undefined) window.clearTimeout(onlineTimer);
      onlineTimer = window.setTimeout(() => setConnectionState(null), 3500);
    };

    if (!navigator.onLine) setConnectionState("offline");
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      if (onlineTimer !== undefined) window.clearTimeout(onlineTimer);
    };
  }, []);

  function dismissStorageNotice() {
    try {
      window.localStorage.setItem("chop-shop-storage-notice-v1", "acknowledged");
    } catch {
      // The notice can still be dismissed for the current page session.
    }
    setStorageNoticeOpen(false);
  }

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
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 shadow-md shadow-indigo-500/25 ring-1 ring-white/20 transition-transform duration-200 group-hover:scale-105 group-hover:rotate-2 group-active:scale-95">
              <span className="font-display text-sm font-black tracking-wider text-white">CS</span>
            </div>
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
                      ? "text-white font-semibold bg-gradient-to-r from-indigo-500/20 to-cyan-500/20 border border-indigo-500/40 shadow-sm"
                      : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]"
                  }`}
                >
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
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
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
              className="inline-flex min-h-11 items-center rounded-full bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-600/30"
            >
              + Cut
            </Link>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
              className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-slate-300 hover:text-white hover:bg-white/[0.08] transition-colors"
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
        {mobileMenuOpen && (
            <div
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
                      className={`flex min-h-11 items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
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
            </div>
          )}
      </header>

      {/* Main Page Content Body */}
      <main id="content" tabIndex={-1} className="flex-1 outline-none relative z-10">
        {children}
      </main>

      {/* Unified App Footer */}
      <footer className="mt-auto border-t border-white/[0.08] bg-[#06070a]/90 px-4 py-8 backdrop-blur-md sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1360px] flex-col gap-5 text-xs text-slate-500">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-display text-sm font-bold tracking-tight text-slate-300">CHOP SHOP</span>
              <span className="text-slate-600">/</span>
              <span>Intelligent vertical video cut room & clipping studio</span>
            </div>
            <nav aria-label="Footer navigation" className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <Link href="/" className="inline-flex min-h-11 items-center transition-colors hover:text-slate-300">Studio</Link>
              <Link href="/library" className="inline-flex min-h-11 items-center transition-colors hover:text-slate-300">Library</Link>
              <Link href="/calendar" className="inline-flex min-h-11 items-center transition-colors hover:text-slate-300">Calendar</Link>
            </nav>
          </div>

          <div className="flex flex-col items-start justify-between gap-3 border-t border-white/[0.07] pt-4 sm:flex-row sm:items-center">
            <span className="text-slate-400">© {new Date().getFullYear()} Chop Shop. All rights reserved.</span>
            <nav aria-label="Legal and privacy" className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <Link href="/privacy" className="inline-flex min-h-11 items-center transition-colors hover:text-slate-200">Privacy</Link>
              <Link href="/terms" className="inline-flex min-h-11 items-center transition-colors hover:text-slate-200">Terms</Link>
              <Link href="/cookies" className="inline-flex min-h-11 items-center transition-colors hover:text-slate-200">Cookies & storage</Link>
            </nav>
            <span className="font-mono text-slate-400">Local-first processing · Cloud publishing optional</span>
          </div>
        </div>
      </footer>

      {connectionState ? (
        <div
          role={connectionState === "offline" ? "alert" : "status"}
          aria-live={connectionState === "offline" ? "assertive" : "polite"}
          aria-atomic="true"
          className="fixed left-1/2 top-20 z-[70] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 rounded-xl border border-white/15 bg-[#11141d] px-4 py-3 text-sm text-slate-100 shadow-2xl"
        >
          {connectionState === "offline"
            ? "You are offline. Existing local pages remain available; uploads and publishing need a connection."
            : "Connection restored."}
        </div>
      ) : null}

      {storageNoticeOpen ? (
        <aside
          role="region"
          aria-label="Browser storage notice"
          className="fixed bottom-4 right-4 z-[60] w-[calc(100%-2rem)] max-w-xl rounded-xl border border-white/15 bg-[#11141d] p-4 shadow-2xl sm:bottom-6 sm:right-6"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">Browser storage notice</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                Chop Shop stores editing settings and library display preferences in this browser.
                No advertising or analytics cookies are configured in the checked-in frontend.
                Cloud publishing, when enabled, uses the services configured by the operator.
              </p>
              <Link href="/cookies" className="mt-2 inline-flex min-h-11 items-center text-xs font-semibold text-cyan-300 underline underline-offset-4 hover:text-white">
                Read storage details
              </Link>
            </div>
            <button
              type="button"
              onClick={dismissStorageNotice}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-white/20 px-4 text-xs font-semibold text-white transition hover:bg-white/10 active:scale-[0.98]"
            >
              Dismiss
            </button>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
