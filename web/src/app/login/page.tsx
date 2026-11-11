"use client";

import { useState } from "react";
import type { FormEvent } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Unable to sign in.");
        setSetupRequired(response.status === 503);
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch {
      setError("Connection failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-black/40 p-8 shadow-2xl">
        <p className="text-xs uppercase tracking-[0.28em] text-white/50">Chop Shop</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Studio access</h1>
        <p className="mt-2 text-sm text-white/60">Enter your private studio password to continue.</p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block text-sm text-white/75" htmlFor="studio-password">Password</label>
          <input
            id="studio-password"
            type="password"
            autoComplete="current-password"
            required
            minLength={1}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white outline-none focus:border-white/40"
          />
          {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
          {setupRequired ? (
            <p className="text-xs text-white/50">Configure CLIPPER_ACCESS_PASSWORD and CLIPPER_AUTH_SECRET in your hosting environment, then redeploy.</p>
          ) : null}
          <button
            type="submit"
            disabled={busy || !password}
            className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Verifying…" : "Unlock studio"}
          </button>
        </form>
      </section>
    </main>
  );
}
