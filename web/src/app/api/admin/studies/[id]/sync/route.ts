import { getRequestUser, isAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { error, json } from "@/lib/http";
import { approveSubmission, getOpportunity, launchOpportunity, listSubmissions } from "@/lib/terac";

/**
 * Terac has no completion webhooks, so this is polled. It approves (and so
 * pays) only submissions whose answers actually arrived on our study page.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user || !isAdmin(user)) return error("Admin only", 403);
  const study = await db.teracStudy.findUnique({ where: { id: (await params).id } });
  if (!study?.teracOpportunityId) return error("Study is not linked to a Terac opportunity", 400);

  const url = new URL(req.url);
  try {
    if (url.searchParams.get("launch") === "1" && study.status === "draft") await launchOpportunity(study.teracOpportunityId);

    const opp = await getOpportunity(study.teracOpportunityId);
    const status = opp.status ?? opp.data?.status ?? study.status;
    const submissions = await listSubmissions(study.teracOpportunityId);
    const received = new Set(
      (await db.feedback.findMany({ where: { studyId: study.id }, select: { teracSubmissionId: true } }))
        .map((f) => f.teracSubmissionId)
        .filter(Boolean),
    );

    const approved: string[] = [];
    const waitingForAnswers: string[] = [];
    for (const s of submissions.filter((s) => s.status === "awaiting_review")) {
      if (received.has(s.id)) {
        await approveSubmission(s.id);
        approved.push(s.id);
      } else {
        waitingForAnswers.push(s.id);
      }
    }
    await db.teracStudy.update({ where: { id: study.id }, data: { status } });
    return json({ status, submissions: submissions.length, approved, waitingForAnswers });
  } catch (e) {
    return error((e as Error).message, 502);
  }
}
