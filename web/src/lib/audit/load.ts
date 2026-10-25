import { db, parseJson } from "../db";
import type { BusinessProfile, Citation, CrawlReport, EvidenceItem, RankedEntity } from "./types";

/** Full audit report shaped for the dashboard and the extension. */
export async function loadAuditReport(auditId: string, userId: string) {
  const audit = await db.audit.findFirst({
    where: { id: auditId, userId },
    include: {
      questions: { orderBy: { id: "asc" } },
      runs: { orderBy: { createdAt: "asc" } },
      findings: true,
    },
  });
  if (!audit) return null;

  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as Record<string, number>;
  return {
    id: audit.id,
    url: audit.url,
    domain: audit.domain,
    status: audit.status,
    stage: audit.stage,
    error: audit.error,
    createdAt: audit.createdAt,
    completedAt: audit.completedAt,
    scores: {
      overall: audit.overallScore,
      readability: audit.readabilityScore,
      visibilityTop3: audit.visibilityTop3,
      visibilityTop5: audit.visibilityTop5,
      citationRate: audit.citationRate,
    },
    engineSummary: parseJson<Record<string, { top3: number; top5: number; cited: number; runs: number; errors: number }>>(audit.engineSummary, {}),
    crawl: parseJson<CrawlReport | null>(audit.crawlReport, null),
    profile: parseJson<(BusinessProfile & { pagesRead?: string[] }) | null>(audit.profile, null),
    config: parseJson<Record<string, unknown>>(audit.configSnapshot, {}),
    questions: audit.questions.map((q) => ({
      id: q.id,
      text: q.text,
      intent: q.intent,
      seedKeyword: q.seedKeyword,
      monthlyVolume: q.monthlyVolume,
      volumeSource: q.volumeSource,
      rejectedReason: q.rejectedReason,
      runs: audit.runs
        .filter((r) => r.questionId === q.id)
        .map((r) => ({
          id: r.id,
          engine: r.engine,
          model: r.model,
          status: r.status,
          error: r.error,
          answerText: r.answerText,
          citations: parseJson<Citation[]>(r.citations, []),
          entities: parseJson<RankedEntity[]>(r.rankedEntities, []),
          brandPosition: r.brandPosition,
          brandCited: r.brandCited,
        })),
    })),
    findings: audit.findings
      .map((f) => ({ ...f, evidence: parseJson<EvidenceItem[]>(f.evidence, []) }))
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.impact - a.impact),
  };
}

export type AuditReport = NonNullable<Awaited<ReturnType<typeof loadAuditReport>>>;
