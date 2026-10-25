"use client";

import Link from "next/link";
import { useState } from "react";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch(`/api/auth/${mode === "login" ? "login" : "register"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Something went wrong");
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.href = next?.startsWith("/") ? next : "/dashboard";
  }

  return (
    <main className="container narrow">
      <form className="panel stack" onSubmit={submit}>
        <h1>{mode === "login" ? "Log in" : "Create your account"}</h1>
        {mode === "signup" && (
          <div>
            <label htmlFor="name">Name</label>
            <input id="name" name="name" autoComplete="name" />
          </div>
        )}
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required minLength={mode === "signup" ? 8 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        </div>
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}</button>
        <p className="small muted">
          {mode === "login" ? (
            <>No account? <Link href="/signup">Sign up</Link></>
          ) : (
            <>Already have an account? <Link href="/login">Log in</Link></>
          )}
        </p>
      </form>
    </main>
  );
}
