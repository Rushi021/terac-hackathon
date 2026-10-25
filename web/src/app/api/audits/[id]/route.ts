import { getRequestUser } from "@/lib/auth";
import { loadAuditReport } from "@/lib/audit/load";
import { error, json } from "@/lib/http";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return error("Not signed in", 401);
  const report = await loadAuditReport((await params).id, user.id);
  if (!report) return error("Audit not found", 404);
  return json({ audit: report });
}
