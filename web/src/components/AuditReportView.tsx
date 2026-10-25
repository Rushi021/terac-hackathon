"use client";

import { useEffect, useState } from "react";
import type { AuditReport } from "@/lib/audit/load";

const STAGES = ["queued", "crawling", "profiling", "questions", "querying", "analyzing", "done"];
const ENGINE_NAMES: Record<string, string> = {
  openai: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  anthropic: "Claude",
};
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const tone = (n: number | null | undefined, scale = 100) => (n == null ? "" : n / scale >= 0.7 ? "good" : n / scale >= 0.4 ? "warn" : "bad");

export function AuditReportView({ auditId }: { auditId: string }) {
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const res = await fetch(`/api/audits/${auditId}`);
      const data = await res.json();
      if (!res.ok) return setError(data.error);
      setAudit(data.audit);
      if (!["done", "failed", "blocked"].includes(data.audit.status)) timer = setTimeout(load, 2500);
    };
    load();
    return () => clearTimeout(timer);
  }, [auditId]);

  if (error) return <main className="container"><p className="error">{error}</p></main>;
  if (!audit) return <main className="container"><p className="muted">Loading…</p></main>;

  const running = !["done", "failed", "blocked"].includes(audit.status);
  const progress = Math.max(5, (STAGES.indexOf(audit.status) / (STAGES.length - 1)) * 100);
  const activeQuestions = audit.questions.filter((q) => !q.rejectedReason);
  const rejected = audit.questions.filter((q) => q.rejectedReason);

  return (
    <main className="container stack">
      <div>
        <p className="small muted">{audit.url}</p>
        <h1>{audit.profile?.businessName ?? audit.domain}</h1>
        {audit.profile && <p className="muted">{audit.profile.summary}</p>}
      </div>

      {running && (
        <div className="panel stack">
          <strong>{audit.stage}</strong>
          <div className="progress"><div style={{ width: `${progress}%` }} /></div>
          <p className="small muted">This usually takes 1–4 minutes. You can leave this page; results are saved.</p>
        </div>
      )}
      {audit.status === "failed" && <div className="panel"><p className="error">Audit failed: {audit.error ?? audit.stage}</p></div>}
      {audit.status === "blocked" && (
        <div className="panel finding critical">
          <h3 className="bad">AI crawlers can’t read this site</h3>
          <p>{audit.stage}</p>
          <ul>{audit.crawl?.blockedReasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}

      {(audit.scores.overall != null || audit.scores.readability != null) && (
        <div className="grid">
          <Score label="Overall" value={audit.scores.overall} />
          <Score label="In AI top 5" value={audit.scores.visibilityTop5 == null ? null : Math.round(audit.scores.visibilityTop5 * 100)} suffix="%" />
          <Score label="In AI top 3" value={audit.scores.visibilityTop3 == null ? null : Math.round(audit.scores.visibilityTop3 * 100)} suffix="%" />
          <Score label="Your site cited" value={audit.scores.citationRate == null ? null : Math.round(audit.scores.citationRate * 100)} suffix="%" />
          <Score label="Agent readability" value={audit.scores.readability} />
        </div>
      )}
      {audit.status === "done" && (
        <p className="small muted">
          Top-5 visibility = share of AI answers that ranked you among the first 5 businesses, computed per engine and averaged so each engine counts equally.
          Overall = 65% visibility + 35% agent readability.
        </p>
      )}

      {Object.keys(audit.engineSummary).length > 0 && (
        <>
          <h2>By AI engine</h2>
          <div className="panel">
            <table>
              <thead><tr><th>Engine</th><th>Top 3</th><th>Top 5</th><th>Cited your site</th><th>Answers</th></tr></thead>
              <tbody>
                {Object.entries(audit.engineSummary).map(([e, s]) => (
                  <tr key={e}>
                    <td>{ENGINE_NAMES[e] ?? e}</td><td>{pct(s.top3)}</td><td className={tone(s.top5, 1)}>{pct(s.top5)}</td><td>{pct(s.cited)}</td>
                    <td>{s.runs}{s.errors ? <span className="error"> ({s.errors} failed)</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {audit.findings.length > 0 && (
        <>
          <h2>What’s happening and how to fix it</h2>
          {audit.findings.map((f) => (
            <div key={f.id} className={`panel finding ${f.severity} stack`}>
              <div className="row">
                <span className={`badge ${f.severity}`}>{f.severity}</span>
                <span className="badge">{f.category}</span>
                <h3 style={{ margin: 0 }}>{f.title}</h3>
                {f.impact > 0 && <span className="small muted">+{f.impact} readability if fixed</span>}
              </div>
              <div className="evidence">
                {f.evidence.map((e, i) => (
                  <div key={i}><b>{e.label}:</b> {e.value}</div>
                ))}
              </div>
              <p><strong>Why it matters.</strong> {f.why}</p>
              <div><strong>Fix.</strong> {f.fix.includes("\n") ? <pre>{f.fix}</pre> : <span> {f.fix}</span>}</div>
            </div>
          ))}
        </>
      )}

      {activeQuestions.length > 0 && (
        <>
          <h2>The questions we asked</h2>
          <p className="small muted">
            Written from your business category only — the generator never saw your name or marketing copy, and any question naming you was dropped.
            {audit.config.humanGuidanceResponses ? ` Style tuned with ${String(audit.config.humanGuidanceResponses)} human ratings.` : ""}
          </p>
          {activeQuestions.map((q) => (
            <details key={q.id} className="panel">
              <summary>
                {q.text}{" "}
                <span className="small muted">
                  · {q.intent}
                  {q.monthlyVolume != null ? ` · ${q.monthlyVolume.toLocaleString()} searches/mo for “${q.seedKeyword}”` : ""}
                  {" · "}
                  {q.runs.map((r) => `${ENGINE_NAMES[r.engine] ?? r.engine}: ${r.status !== "ok" ? "error" : r.brandPosition ? `#${r.brandPosition}` : "absent"}`).join(" · ")}
                </span>
              </summary>
              <div className="stack" style={{ marginTop: "1rem" }}>
                {q.runs.map((r) => (
                  <div key={r.id} className="stack">
                    <h3>{ENGINE_NAMES[r.engine] ?? r.engine} <span className="small muted">({r.model})</span></h3>
                    {r.status !== "ok" ? (
                      <p className="error small">{r.error}</p>
                    ) : (
                      <>
                        <p className="small">
                          <strong>Ranking:</strong>{" "}
                          {r.entities.length ? r.entities.map((e) => `#${e.position} ${e.name}`).join(", ") : "no businesses named"}
                          {" — "}
                          <strong className={r.brandPosition && r.brandPosition <= 5 ? "good" : "bad"}>
                            {r.brandPosition ? `you were #${r.brandPosition}` : "you were not mentioned"}
                          </strong>
                          {r.brandCited ? " · your site was cited" : ""}
                        </p>
                        <div className="answer">{r.answerText}</div>
                        {r.citations.length > 0 && (
                          <ol className="small">
                            {r.citations.slice(0, 10).map((c) => (
                              <li key={c.url}><a href={c.url} target="_blank" rel="noreferrer">{c.title || c.domain}</a> <span className="muted">({c.domain})</span></li>
                            ))}
                          </ol>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </details>
          ))}
          {rejected.length > 0 && (
            <p className="small muted">Dropped by the bias filter: {rejected.map((q) => `“${q.text}” (${q.rejectedReason})`).join("; ")}</p>
          )}
          {audit.status === "done" && <QuestionFeedback auditId={audit.id} questions={activeQuestions.map((q) => ({ id: q.id, text: q.text }))} />}
        </>
      )}

      {audit.crawl && (
        <>
          <h2>AI crawler access</h2>
          <div className="panel">
            <table>
              <thead><tr><th>Crawler</th><th>Used for</th><th>robots.txt</th><th>Live request</th></tr></thead>
              <tbody>
                {audit.crawl.bots.map((b) => (
                  <tr key={b.bot}>
                    <td><strong>{b.bot}</strong><div className="small muted">{b.owner}</div></td>
                    <td className="small">{b.purpose}</td>
                    <td className="small">
                      <span className={`badge ${b.robotsAllowed ? "ok" : "critical"}`}>{b.robotsAllowed ? "allowed" : "blocked"}</span>
                      {b.robotsRule && <div className="muted"><code>{b.robotsRule}</code></div>}
                    </td>
                    <td className="small">
                      {b.liveStatus == null ? <span className="muted">not tested</span> : (
                        <span className={`badge ${b.liveBlocked ? "critical" : "ok"}`}>{b.liveBlocked ? "blocked" : `HTTP ${b.liveStatus}`}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted">
              robots.txt {audit.crawl.robots.found ? "found" : "not found"} · sitemap {audit.crawl.sitemap.found ? `${audit.crawl.sitemap.urlCount} URLs` : "not found"} · llms.txt {audit.crawl.llmsTxt.found ? "found" : "not found"}
              {audit.crawl.homepage && ` · homepage ${audit.crawl.homepage.wordCount} words without JavaScript, ${audit.crawl.homepage.ms} ms`}
            </p>
            <p className="small muted">
              These checks show whether crawlers are allowed and able to read your site. Confirming they actually visit requires your server or CDN logs.
            </p>
          </div>
        </>
      )}
    </main>
  );
}

function Score({ label, value, suffix = "" }: { label: string; value: number | null | undefined; suffix?: string }) {
  return (
    <div className="panel">
      <div className="score-label">{label}</div>
      <div className={`score ${tone(value)}`}>{value == null ? "—" : `${value}${suffix}`}</div>
    </div>
  );
}

function QuestionFeedback({ auditId, questions }: { auditId: string; questions: { id: string; text: string }[] }) {
  const [ratings, setRatings] = useState<Record<string, boolean>>({});
  const [sent, setSent] = useState(false);
  if (sent) return <p className="small good">Thanks — your ratings improve the questions in future audits.</p>;
  return (
    <div className="panel stack">
      <h3>Are these the questions your customers really ask?</h3>
      {questions.map((q) => (
        <div key={q.id} className="row small">
          <span style={{ flex: 1 }}>{q.text}</span>
          <button type="button" className={ratings[q.id] === true ? "" : "secondary"} onClick={() => setRatings({ ...ratings, [q.id]: true })}>Yes</button>
          <button type="button" className={ratings[q.id] === false ? "" : "secondary"} onClick={() => setRatings({ ...ratings, [q.id]: false })}>No</button>
        </div>
      ))}
      <button
        disabled={!Object.keys(ratings).length}
        onClick={async () => {
          await fetch(`/api/audits/${auditId}/feedback`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              kind: "question_relevance",
              payload: { ratings: questions.filter((q) => q.id in ratings).map((q) => ({ questionId: q.id, question: q.text, realistic: ratings[q.id] })) },
            }),
          });
          setSent(true);
        }}
      >
        Send ratings
      </button>
    </div>
  );
}
