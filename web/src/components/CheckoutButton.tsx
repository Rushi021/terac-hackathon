"use client";

import { useState } from "react";

export function CheckoutButton() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch("/api/billing/checkout", { method: "POST" });
          const data = await res.json();
          if (!res.ok) {
            setBusy(false);
            return setError(data.error);
          }
          window.location.href = data.url;
        }}
      >
        {busy ? "Opening checkout…" : "Buy audit credits"}
      </button>
      {error && <p className="error">{error}</p>}
    </>
  );
}
