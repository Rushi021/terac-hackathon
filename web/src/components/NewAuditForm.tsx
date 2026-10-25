"use client";

import Link from "next/link";
import { useState } from "react";

export function NewAuditForm({ credits }: { credits: number }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const url = new FormData(e.currentTarget).get("url");
    const res = await fetch("/api/audits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error);
    window.location.href = `/audits/${data.audit.id}`;
  }

  return (
    <form className="panel stack" onSubmit={submit}>
      <label htmlFor="url">Website to audit</label>
      <div className="row">
        <input id="url" name="url" placeholder="yourbusiness.com" required style={{ flex: 1 }} />
        <button disabled={busy || credits < 1}>{busy ? "Starting…" : "Run audit"}</button>
      </div>
      <p className="small muted">
        {credits} audit credit{credits === 1 ? "" : "s"} left.{" "}
        {credits < 1 && <Link href="/billing">Get more credits</Link>}
      </p>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
