import { z } from "zod";
import { getRequestUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { error, json, parseBody } from "@/lib/http";
import { track } from "@/lib/observe";

const schema = z.object({
  kind: z.enum(["question_relevance", "report_clarity", "general"]),
  payload: z.record(z.string(), z.unknown()),
});

/** In-app feedback from the business owner on their own report. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return error("Not signed in", 401);
  const { id } = await params;
  const audit = await db.audit.findFirst({ where: { id, userId: user.id }, select: { id: true } });
  if (!audit) return error("Audit not found", 404);
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  await db.feedback.create({
    data: { source: "user", auditId: id, userId: user.id, kind: body.data.kind, payload: JSON.stringify(body.data.payload) },
  });
  void track({ type: "feedback.user", userId: user.id, auditId: id, operation: body.data.kind });
  return json({ ok: true }, 201);
}
