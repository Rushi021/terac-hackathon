import { redirect } from "next/navigation";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { integrationStatus } from "@/lib/config";
import { db } from "@/lib/db";
import { StudyAdmin } from "@/components/StudyAdmin";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/admin");
  if (!isAdmin(user)) return <main className="container"><p className="error">Admins only. Add your email to ADMIN_EMAILS.</p></main>;

  const audits = await db.audit.findMany({
    where: { status: "done" },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, domain: true, createdAt: true },
  });
  return (
    <main className="container stack">
      <h1>Human feedback studies</h1>
      <p className="muted">
        Launch Terac studies where general-population participants judge whether our generated questions sound like what real people ask
        (and whether reports are clear). Their labels are fed into the question generator for every later audit — compare a study run on an
        audit generated before feedback (guidance = 0) with one generated after.
      </p>
      <pre className="small">{JSON.stringify(integrationStatus(), null, 2)}</pre>
      <StudyAdmin audits={audits.map((a) => ({ id: a.id, label: `${a.domain} · ${a.createdAt.toLocaleDateString()}` }))} />
    </main>
  );
}
