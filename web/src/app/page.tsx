import Link from "next/link";

export default function Home() {
  return (
    <main className="container stack">
      <h1 style={{ fontSize: "2.6rem", maxWidth: 720 }}>When customers ask ChatGPT for a business like yours, do you get recommended?</h1>
      <p className="muted" style={{ fontSize: "1.15rem", maxWidth: 680 }}>
        Paste your website. We check whether AI crawlers can read it, work out what your customers actually ask, put those
        questions to ChatGPT, Perplexity, Gemini and Claude, and show you how often you land in the top 5 — with the evidence
        for every gap and the exact fix.
      </p>
      <div className="row">
        <Link href="/signup" className="button">Run a free audit</Link>
        <Link href="/login" className="button secondary">Log in</Link>
      </div>
      <div className="grid" style={{ marginTop: "2rem" }}>
        {[
          ["1. Can AI read you?", "robots.txt rules per AI crawler, firewall blocks, noindex, and how much text exists without JavaScript."],
          ["2. What do customers ask?", "We learn your business from your pages, size demand, and write neutral questions that never mention you."],
          ["3. Who gets recommended?", "Each question goes to every AI engine. We record the ranking, the citations and where you placed."],
          ["4. Why, and what to fix", "We compare you against the pages and listings AI cited instead, and turn each gap into a concrete fix."],
        ].map(([t, d]) => (
          <div className="panel" key={t}>
            <h3>{t}</h3>
            <p className="muted small">{d}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
