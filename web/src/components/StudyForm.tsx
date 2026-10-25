"use client";

import { useEffect, useState } from "react";

type Material = {
  id: string;
  kind: "question_relevance" | "report_clarity";
  title: string;
  status: string;
  category: string | null;
  location: string | null;
  questions: { id: string; text: string }[];
  findings: { id: string; title: string; why: string; fix: string }[];
};

export function StudyForm({ studyId }: { studyId: string }) {
  const [study, setStudy] = useState<Material | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, boolean>>({});
  const [suggestion, setSuggestion] = useState("");
  const [clarity, setClarity] = useState<number | null>(null);
  const [wouldAct, setWouldAct] = useState<boolean | null>(null);
  const [confusing, setConfusing] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/study/${studyId}`)
      .then((r) => r.json().then((d) => (r.ok ? setStudy(d.study) : setError(d.error))))
      .catch(() => setError("Could not load the study"));
  }, [studyId]);

  if (error) return <main className="container narrow"><p className="error">{error}</p></main>;
  if (!study) return <main className="container narrow"><p className="muted">Loading…</p></main>;
  if (done) {
    return (
      <main className="container narrow panel stack">
        <h1>Thank you!</h1>
        <p>Your answers were saved. You can return to Terac and mark the task as complete.</p>
      </main>
    );
  }

  const isQuestions = study.kind === "question_relevance";
  const complete = isQuestions
    ? study.questions.every((q) => q.id in ratings) && suggestion.trim().length >= 10
    : clarity !== null && wouldAct !== null;

  async function submit() {
    setBusy(true);
    const params = new URLSearchParams(window.location.search);
    const res = await fetch(`/api/study/${studyId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teracSubmissionId: params.get("teracSubmissionId") ?? undefined,
        submissionId: params.get("submissionId") ?? undefined,
        taskId: params.get("taskId") ?? undefined,
        ...(isQuestions
          ? { ratings: study!.questions.map((q) => ({ questionId: q.id, question: q.text, realistic: ratings[q.id] })), suggestion }
          : { clarity, wouldAct, confusing }),
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error);
    setDone(true);
  }

  return (
    <main className="container stack" style={{ maxWidth: 720 }}>
      <h1>{study.title}</h1>
      {isQuestions ? (
        <>
          <p>
            Imagine you need a <strong>{study.category ?? "local business"}</strong>
            {study.location ? <> in <strong>{study.location}</strong></> : null} and you ask an AI assistant like ChatGPT for help.
            For each question below: <strong>would a real person actually ask this?</strong>
          </p>
          <div className="panel stack">
            {study.questions.map((q, i) => (
              <div key={q.id} className="row">
                <span style={{ flex: 1 }}>{i + 1}. {q.text}</span>
                <button type="button" className={ratings[q.id] === true ? "" : "secondary"} onClick={() => setRatings({ ...ratings, [q.id]: true })}>Yes, realistic</button>
                <button type="button" className={ratings[q.id] === false ? "" : "secondary"} onClick={() => setRatings({ ...ratings, [q.id]: false })}>No</button>
              </div>
            ))}
          </div>
          <div className="panel">
            <label htmlFor="s">In your own words, what would you type into ChatGPT to find this kind of business?</label>
            <textarea id="s" rows={3} value={suggestion} onChange={(e) => setSuggestion(e.target.value)} />
          </div>
        </>
      ) : (
        <>
          <p>These findings come from a report for a small business. Read them, then tell us how clear they are.</p>
          {study.findings.map((f) => (
            <div key={f.id} className="panel stack">
              <h3>{f.title}</h3>
              <p className="small"><strong>Why:</strong> {f.why}</p>
              <p className="small"><strong>Fix:</strong> {f.fix}</p>
            </div>
          ))}
          <div className="panel stack">
            <label>How clear were these findings? (1 = very confusing, 5 = very clear)</label>
            <div className="row">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" className={clarity === n ? "" : "secondary"} onClick={() => setClarity(n)}>{n}</button>
              ))}
            </div>
            <label>If this was your business, would you know what to do next?</label>
            <div className="row">
              <button type="button" className={wouldAct === true ? "" : "secondary"} onClick={() => setWouldAct(true)}>Yes</button>
              <button type="button" className={wouldAct === false ? "" : "secondary"} onClick={() => setWouldAct(false)}>No</button>
            </div>
            <label htmlFor="c">What was confusing or missing? (optional)</label>
            <textarea id="c" rows={3} value={confusing} onChange={(e) => setConfusing(e.target.value)} />
          </div>
        </>
      )}
      <button disabled={!complete || busy} onClick={submit}>{busy ? "Saving…" : "Submit"}</button>
      {!complete && <p className="small muted">Answer every item{isQuestions ? " and write your own question (10+ characters)" : ""} to submit.</p>}
    </main>
  );
}
