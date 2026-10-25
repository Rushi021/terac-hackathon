import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { NewAuditForm } from "@/components/NewAuditForm";

export default async function Dashboard() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/dashboard");
  const audits = await db.audit.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });

  return (
    <main className="container stack">
      <h1>Your audits</h1>
      <NewAuditForm credits={user.auditCredits} />
      <div className="panel">
        {audits.length === 0 ? (
          <p className="muted">No audits yet. Paste your website above to run your first one.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Website</th><th>Status</th><th>Overall</th><th>Top-5 visibility</th><th>Readability</th><th>Date</th></tr>
            </thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id}>
                  <td><Link href={`/audits/${a.id}`}>{a.domain}</Link></td>
                  <td><span className={`badge ${a.status === "done" ? "ok" : a.status === "blocked" || a.status === "failed" ? "critical" : ""}`}>{a.status}</span></td>
                  <td>{a.overallScore ?? "—"}</td>
                  <td>{a.visibilityTop5 == null ? "—" : `${Math.round(a.visibilityTop5 * 100)}%`}</td>
                  <td>{a.readabilityScore ?? "—"}</td>
                  <td className="small muted">{a.createdAt.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
