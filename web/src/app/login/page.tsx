"use client";

import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to sign in.");
      const requested = new URLSearchParams(window.location.search).get("next") || "/";
      const destination = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";
      window.location.assign(destination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md items-center px-5 py-12">
      <section className="w-full rounded-2xl border border-white/10 bg-neutral-950 p-7 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-lime-300">Chop Shop / Private Studio</p>
        <h1 className="mt-3 text-3xl font-bold text-white">Sign in</h1>
        <p className="mt-2 text-sm text-neutral-400">Enter the studio access password to continue.</p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          <label className="block text-sm font-medium text-neutral-200" htmlFor="password">Access password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            maxLength={512}
            className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-white outline-none focus:border-lime-300 focus:ring-2 focus:ring-lime-300/20"
          />
          {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
          <button
            type="submit"
            disabled={busy || !password}
            className="w-full rounded-xl bg-lime-300 px-4 py-3 font-semibold text-neutral-950 transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Enter studio"}
          </button>
        </form>
        <p className="mt-5 text-xs leading-relaxed text-neutral-500">
          Production setup requires CLIPPER_ACCESS_PASSWORD (16+ characters) and CLIPPER_AUTH_SECRET (32+ random characters).
        </p>
      </section>
    </main>
  );
}
