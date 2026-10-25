"use client";

import { useCallback, useEffect, useState } from "react";

type Study = {
  id: string;
  kind: string;
  title: string;
  status: string;
  auditDomain: string | null;
  guidanceAtGeneration: number | null;
  teracOpportunityId: string | null;
  numParticipants: number;
  responses: number;
  realisticRate: number | null;
  clarity: number | null;
};

export function StudyAdmin({ audits }: { audits: { id: string; label: string }[] }) {
  const [studies, setStudies] = useState<Study[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/studies");
    if (res.ok) setStudies((await res.json()).studies);
  }, []);
  useEffect(() => void load(), [load]);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/admin/studies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: f.get("kind"), auditId: f.get("auditId"), numParticipants: Number(f.get("n")), launch: f.get("launch") === "on" }),
    });
    const data = await res.json();
    setBusy(false);
    setMessage(data.error ?? data.note ?? `Study created. Task URL: ${data.taskUrl}`);
    load();
  }

  async function sync(id: string, launch = false) {
    const res = await fetch(`/api/admin/studies/${id}/sync${launch ? "?launch=1" : ""}`, { method: "POST" });
    const data = await res.json();
    setMessage(res.ok ? `Status ${data.status}: ${data.submissions} submissions, approved ${data.approved.length}, waiting for answers ${data.waitingForAnswers.length}` : data.error);
    load();
  }

  return (
    <>
      <form className="panel stack" onSubmit={create}>
        <h3>New study</h3>
        <div className="grid">
          <div>
            <label>Type</label>
            <select name="kind">
              <option value="question_relevance">Question realism</option>
              <option value="report_clarity">Report clarity</option>
            </select>
          </div>
          <div>
            <label>Audit</label>
            <select name="auditId" required>
              {audits.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <label>Participants</label>
            <input name="n" type="number" min={1} max={200} defaultValue={10} />
          </div>
        </div>
        <label className="row small" style={{ fontWeight: 400 }}>
          <input type="checkbox" name="launch" style={{ width: "auto" }} /> Launch on Terac immediately (spends credits)
        </label>
        <button disabled={busy || !audits.length}>{busy ? "Creating…" : "Create study"}</button>
        {!audits.length && <p className="small muted">Complete an audit first.</p>}
      </form>
      {message && <div className="panel small">{message}</div>}
      <div className="panel">
        <table>
          <thead>
            <tr><th>Study</th><th>Audit</th><th>Guidance at generation</th><th>Status</th><th>Responses</th><th>Realistic %</th><th>Clarity</th><th /></tr>
          </thead>
          <tbody>
            {studies.map((s) => (
              <tr key={s.id}>
                <td><a href={`/study/${s.id}`} target="_blank" rel="noreferrer">{s.kind}</a></td>
                <td>{s.auditDomain}</td>
                <td>{s.guidanceAtGeneration ?? "—"}</td>
                <td>{s.status}</td>
                <td>{s.responses}/{s.numParticipants}</td>
                <td>{s.realisticRate == null ? "—" : `${Math.round(s.realisticRate * 100)}%`}</td>
                <td>{s.clarity == null ? "—" : s.clarity.toFixed(1)}</td>
                <td className="row">
                  {s.teracOpportunityId && <button className="secondary" onClick={() => sync(s.id)}>Sync & approve</button>}
                  {s.teracOpportunityId && s.status === "draft" && <button onClick={() => sync(s.id, true)}>Launch</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
