import { z } from "zod";
import { db } from "@/lib/db";
import { error, json, parseBody } from "@/lib/http";
import { track } from "@/lib/observe";
import { studyMaterial } from "@/lib/studies";

// Public: Terac participants reach this through the opportunity's task URL.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const material = await studyMaterial((await params).id);
  if (!material) return error("Study not found", 404);
  return json({ study: material });
}

const schema = z.object({
  teracSubmissionId: z.string().max(200).optional(),
  submissionId: z.string().max(200).optional(),
  taskId: z.string().max(200).optional(),
  ratings: z.array(z.object({ questionId: z.string(), question: z.string().max(500), realistic: z.boolean() })).max(50).optional(),
  suggestion: z.string().max(1000).optional(),
  clarity: z.number().int().min(1).max(5).optional(),
  wouldAct: z.boolean().optional(),
  confusing: z.string().max(2000).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const study = await db.teracStudy.findUnique({ where: { id } });
  if (!study) return error("Study not found", 404);
  if (["completed", "stopped", "cancelled", "expired"].includes(study.status)) return error("This study has closed", 410);

  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const teracSubmissionId = body.data.teracSubmissionId ?? body.data.submissionId ?? null;

  if (teracSubmissionId && (await db.feedback.findFirst({ where: { studyId: id, teracSubmissionId } }))) {
    return error("You have already submitted this study", 409);
  }

  await db.feedback.create({
    data: {
      source: teracSubmissionId ? "terac" : "anonymous",
      studyId: id,
      auditId: study.auditId,
      teracSubmissionId,
      kind: study.kind,
      payload: JSON.stringify(body.data),
    },
  });
  void track({ type: "study.submission", auditId: study.auditId, provider: teracSubmissionId ? "terac" : undefined, operation: study.kind, data: { studyId: id, teracSubmissionId } });
  return json({ ok: true }, 201);
}
