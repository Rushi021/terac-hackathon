import { z } from "zod";
import { getRequestUser } from "@/lib/auth";
import { bareDomain, normalizeUrl } from "@/lib/audit/fetcher";
import { runAudit } from "@/lib/audit/pipeline";
import { db } from "@/lib/db";
import { clientKind, error, json, parseBody } from "@/lib/http";
import { track } from "@/lib/observe";

export const runtime = "nodejs";

const schema = z.object({ url: z.string().min(3).max(2000) });

export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return error("Not signed in", 401);
  const audits = await db.audit.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, url: true, domain: true, status: true, stage: true, overallScore: true, visibilityTop5: true, readabilityScore: true, createdAt: true },
  });
  return json({ audits });
}

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return error("Not signed in", 401);
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  let url: URL;
  try {
    url = normalizeUrl(body.data.url);
  } catch {
    return error("That doesn't look like a website address");
  }
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(url.hostname) || !url.hostname.includes(".")) {
    return error("Please enter a public website address");
  }

  // Atomically spend one credit so concurrent requests cannot overdraw.
  const spent = await db.user.updateMany({ where: { id: user.id, auditCredits: { gt: 0 } }, data: { auditCredits: { decrement: 1 } } });
  if (spent.count === 0) {
    void track({ type: "audit.rejected", level: "warn", userId: user.id, message: "out of credits", data: { url: url.toString() } });
    return error("You're out of audit credits", 402, { upgrade: "/billing" });
  }

  const audit = await db.audit.create({ data: { userId: user.id, url: url.toString(), domain: bareDomain(url.hostname), stage: "Queued" } });
  void track({ type: "audit.created", userId: user.id, auditId: audit.id, data: { url: audit.url, client: clientKind(req) } });

  // POC: runs in-process. Move to a job queue (e.g. Inngest, BullMQ) before scaling.
  void runAudit(audit.id);

  return json({ audit: { id: audit.id, status: audit.status } }, 202);
}
