import { z } from "zod";
import { getRequestUser, isAdmin } from "@/lib/auth";
import { config } from "@/lib/config";
import { db, parseJson } from "@/lib/db";
import { error, json, parseBody } from "@/lib/http";
import { averageClarity, realisticRate } from "@/lib/studies";
import { createOpportunity, ensureProject, launchOpportunity } from "@/lib/terac";

const DESCRIPTIONS = {
  question_relevance: {
    title: "Would you ask an AI assistant this? (5 min)",
    description:
      "You'll see a short list of questions someone might type into ChatGPT or a similar AI assistant when looking for a local business or service. For each one, tell us whether it sounds like something a real person would ask, then write one question you would ask instead.",
  },
  report_clarity: {
    title: "Rate how clear a website report is (5 min)",
    description:
      "You'll read a few findings from an automated report that tells a small business why it does or doesn't show up in AI search. Rate how clear and actionable they are, and tell us what was confusing.",
  },
} as const;

async function requireAdmin(req: Request) {
  const user = await getRequestUser(req);
  return user && isAdmin(user) ? user : null;
}

export async function GET(req: Request) {
  if (!(await requireAdmin(req))) return error("Admin only", 403);
  const studies = await db.teracStudy.findMany({ orderBy: { createdAt: "desc" }, include: { feedback: { select: { payload: true } } } });
  const audits = await db.audit.findMany({
    where: { id: { in: studies.map((s) => s.auditId).filter((x): x is string => !!x) } },
    select: { id: true, domain: true, configSnapshot: true },
  });
  return json({
    studies: studies.map((s) => {
      const audit = audits.find((a) => a.id === s.auditId);
      const payloads = s.feedback.map((f) => f.payload);
      return {
        id: s.id,
        kind: s.kind,
        title: s.title,
        status: s.status,
        auditId: s.auditId,
        auditDomain: audit?.domain ?? null,
        // How much human guidance the audit's question generator had: 0 = "before".
        guidanceAtGeneration: parseJson<{ humanGuidanceResponses?: number }>(audit?.configSnapshot, {}).humanGuidanceResponses ?? null,
        teracOpportunityId: s.teracOpportunityId,
        numParticipants: s.numParticipants,
        responses: payloads.length,
        realisticRate: realisticRate(payloads),
        clarity: averageClarity(payloads),
        createdAt: s.createdAt,
      };
    }),
  });
}

const schema = z.object({
  kind: z.enum(["question_relevance", "report_clarity"]),
  auditId: z.string(),
  numParticipants: z.number().int().min(1).max(200).default(10),
  launch: z.boolean().default(false),
});

export async function POST(req: Request) {
  if (!(await requireAdmin(req))) return error("Admin only", 403);
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const { kind, auditId, numParticipants, launch } = body.data;
  if (!(await db.audit.findUnique({ where: { id: auditId } }))) return error("Audit not found", 404);

  const copy = DESCRIPTIONS[kind];
  const study = await db.teracStudy.create({ data: { kind, auditId, title: copy.title, numParticipants } });
  const taskUrl = `${config.appUrl}/study/${study.id}`;

  if (!config.terac.apiKey) {
    return json({ study, taskUrl, note: "TERAC_API_KEY not set: study created locally only. Share the task URL to collect responses manually." }, 201);
  }
  if (!taskUrl.startsWith("https://")) {
    return json({ study, taskUrl, note: "APP_URL must be a public https URL before Terac participants can reach the study page." }, 201);
  }

  try {
    const projectId = await ensureProject("AI Visibility Audit — human validation");
    const opportunityId = await createOpportunity(projectId, { ...copy, taskUrl, numParticipants, durationMinutes: 5 });
    let status = "draft";
    if (launch) {
      await launchOpportunity(opportunityId);
      status = "active";
    }
    const updated = await db.teracStudy.update({ where: { id: study.id }, data: { teracProjectId: projectId, teracOpportunityId: opportunityId, status } });
    return json({ study: updated, taskUrl }, 201);
  } catch (e) {
    return json({ study, taskUrl, error: (e as Error).message }, 502);
  }
}
