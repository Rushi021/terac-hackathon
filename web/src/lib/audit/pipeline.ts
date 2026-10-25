import type { Audit } from "@prisma/client";
import { config, integrationStatus, type EngineName } from "../config";
import { db } from "../db";
import { track, withContext } from "../observe";
import { readabilityScore, runCrawlChecks } from "./crawl";
import { keywordVolumes, type KeywordVolume } from "./demand";
import { askEngine, enabledEngines } from "./engines";
import { mapLimit, normalizeUrl } from "./fetcher";
import { analyzeGaps, type RunForGaps } from "./gaps";
import { fetchSignals, pickInternalPages } from "./page";
import { buildProfile } from "./profile";
import { generateQuestions, loadHumanGuidance } from "./questions";
import { extractEntities, locateBrand } from "./rank";
import type { FindingInput, PageSignals } from "./types";

const TOP_N = 5;

const currentStage = new Map<string, { status: string; started: number }>();

/** Records the finished stage's duration when the status changes; progress-only updates are not tracked. */
function closeStage(auditId: string, next: string | null) {
  const prev = currentStage.get(auditId);
  if (prev && prev.status !== next) {
    void track({ type: "audit.stage", auditId, operation: prev.status, status: "ok", durationMs: Date.now() - prev.started });
  }
  if (next === null) currentStage.delete(auditId);
  else if (!prev || prev.status !== next) currentStage.set(auditId, { status: next, started: Date.now() });
}

async function setStage(auditId: string, status: string, stage: string) {
  closeStage(auditId, status);
  await db.audit.update({ where: { id: auditId }, data: { status, stage } });
}

async function saveFindings(auditId: string, findings: FindingInput[]) {
  if (!findings.length) return;
  await db.finding.createMany({
    data: findings.map((f) => ({ ...f, auditId, evidence: JSON.stringify(f.evidence) })),
  });
}

/** Share of runs meeting `pred`, computed per engine then averaged with equal weight per engine. */
function perEngineRate<R extends { engine: string; status: string }>(runs: R[], pred: (r: R) => boolean) {
  const engines = [...new Set(runs.filter((r) => r.status === "ok").map((r) => r.engine))];
  if (!engines.length) return { overall: null as number | null, byEngine: {} as Record<string, number> };
  const byEngine: Record<string, number> = {};
  for (const e of engines) {
    const er = runs.filter((r) => r.engine === e && r.status === "ok");
    byEngine[e] = er.filter(pred).length / er.length;
  }
  return { overall: Object.values(byEngine).reduce((a, b) => a + b, 0) / engines.length, byEngine };
}

export async function runAudit(auditId: string) {
  const audit = await db.audit.findUniqueOrThrow({ where: { id: auditId } });
  const started = Date.now();
  await withContext({ auditId, userId: audit.userId }, () => execute(audit));
  closeStage(auditId, null);
  const final = await db.audit.findUnique({
    where: { id: auditId },
    select: { status: true, error: true, overallScore: true, readabilityScore: true, visibilityTop3: true, visibilityTop5: true, citationRate: true },
  });
  void track({
    type: "audit.finished",
    level: final?.status === "failed" ? "error" : "info",
    auditId,
    userId: audit.userId,
    status: final?.status,
    durationMs: Date.now() - started,
    message: final?.error ?? undefined,
    data: {
      domain: audit.domain,
      overall: final?.overallScore ?? null,
      readability: final?.readabilityScore ?? null,
      top3: final?.visibilityTop3 ?? null,
      top5: final?.visibilityTop5 ?? null,
      cited: final?.citationRate ?? null,
    },
  });
}

async function execute(audit: Audit) {
  const auditId = audit.id;
  try {
    const startUrl = normalizeUrl(audit.url);
    const guidance = await loadHumanGuidance();
    await db.audit.update({
      where: { id: auditId },
      data: { configSnapshot: JSON.stringify({ integrations: integrationStatus(), topN: TOP_N, humanGuidanceResponses: guidance.responses }) },
    });

    // 1. Can AI crawlers reach and read the site?
    await setStage(auditId, "crawling", "Checking whether AI crawlers can access your site");
    const crawl = await runCrawlChecks(startUrl);
    await saveFindings(auditId, crawl.findings);
    const readability = readabilityScore(crawl.findings);

    if (crawl.report.blocked) {
      await db.audit.update({
        where: { id: auditId },
        data: {
          status: "blocked",
          stage: "AI crawlers cannot read this site, so it cannot appear in AI answers. Fix the critical issues and re-run.",
          crawlReport: JSON.stringify(crawl.report),
          readabilityScore: readability,
          visibilityTop3: 0,
          visibilityTop5: 0,
          citationRate: 0,
          overallScore: Math.round(readability * 0.35),
          completedAt: new Date(),
        },
      });
      return;
    }
    await db.audit.update({ where: { id: auditId }, data: { crawlReport: JSON.stringify(crawl.report), readabilityScore: readability } });

    // 2. Understand the business from its own pages.
    await setStage(auditId, "profiling", "Reading your site to understand the business");
    const internal = crawl.home ? pickInternalPages(crawl.home, crawl.sitemapUrls, config.audit.maxPages - 1) : [];
    const extra = await mapLimit(internal, 4, async (u) => (await fetchSignals(u)).signals);
    const pages: PageSignals[] = [crawl.home!, ...extra.filter((p) => p.status >= 200 && p.status < 300 && p.wordCount > 30)];
    const profile = await buildProfile(audit.domain, pages);
    await db.audit.update({ where: { id: auditId }, data: { profile: JSON.stringify({ ...profile, pagesRead: pages.map((p) => p.finalUrl) }) } });

    // 3. What do customers search for, and what would they ask an AI?
    await setStage(auditId, "questions", "Measuring search demand and writing neutral customer questions");
    let volumes: KeywordVolume[];
    try {
      volumes = await keywordVolumes(profile.seedKeywords, profile.location.country);
    } catch (e) {
      volumes = profile.seedKeywords.map((keyword) => ({ keyword, monthlyVolume: null, source: null }));
      await saveFindings(auditId, [{ category: "content", severity: "info", title: "Search volume lookup failed", evidence: [{ label: "Error", value: (e as Error).message }], why: "Questions were generated without demand weighting.", fix: "Check DataForSEO credentials.", impact: 0 }]);
    }
    const generated = await generateQuestions(profile, volumes, audit.domain, config.audit.maxQuestions, guidance);
    const volumeByKeyword = new Map(volumes.map((v) => [v.keyword, v]));
    const questions = await Promise.all(
      generated.map((q) =>
        db.auditQuestion.create({
          data: {
            auditId,
            text: q.text,
            intent: q.intent,
            seedKeyword: q.seedKeyword,
            monthlyVolume: q.seedKeyword ? volumeByKeyword.get(q.seedKeyword.toLowerCase())?.monthlyVolume ?? null : null,
            volumeSource: q.seedKeyword ? volumeByKeyword.get(q.seedKeyword.toLowerCase())?.source ?? null : null,
            rejectedReason: q.rejectedReason,
          },
        }),
      ),
    );
    const active = questions.filter((q) => !q.rejectedReason).slice(0, config.audit.maxQuestions);

    // 4. Ask each answer engine.
    const engines = active.length ? enabledEngines() : [];
    if (!active.length) {
      await saveFindings(auditId, [{
        category: "visibility",
        severity: "info",
        title: "Customer questions could not be generated",
        evidence: [{ label: "LLM configured", value: integrationStatus().llm ? "yes" : "no" }],
        why: "Visibility is measured by asking AI engines neutral customer questions; without them only crawlability and readability were scored.",
        fix: "Add OPENAI_API_KEY to enable business profiling and question generation.",
        impact: 0,
      }]);
    } else if (!engines.length) {
      await saveFindings(auditId, [{
        category: "visibility",
        severity: "info",
        title: "No AI answer engines configured",
        evidence: [{ label: "Configured engines", value: "none" }],
        why: "Visibility could not be measured; only crawlability and readability were scored.",
        fix: "Add OPENAI_API_KEY, PERPLEXITY_API_KEY, GEMINI_API_KEY and/or ANTHROPIC_API_KEY.",
        impact: 0,
      }]);
    }
    const jobs = active.flatMap((q) => engines.map((engine) => ({ q, engine })));
    let done = 0;
    await setStage(auditId, "querying", `Asking ${engines.length} AI engine(s) ${active.length} questions (0/${jobs.length})`);
    const gapRuns: RunForGaps[] = [];
    await mapLimit(jobs, 4, async ({ q, engine }) => {
      const started = Date.now();
      try {
        const answer = await askEngine(engine as EngineName, q.text);
        const entities = await extractEntities(q.text, answer.text, answer.citations);
        const brand = locateBrand(entities, answer.text, answer.citations, profile, audit.domain);
        await db.engineRun.create({
          data: {
            auditId,
            questionId: q.id,
            engine,
            model: answer.model,
            status: "ok",
            answerText: answer.text,
            citations: JSON.stringify(answer.citations),
            rankedEntities: JSON.stringify(entities),
            brandPosition: brand.position,
            brandCited: brand.cited,
            latencyMs: Date.now() - started,
          },
        });
        gapRuns.push({ engine: engine as EngineName, question: q.text, status: "ok", brandPosition: brand.position, brandCited: brand.cited, entities, citations: answer.citations });
      } catch (e) {
        await db.engineRun.create({
          data: { auditId, questionId: q.id, engine, model: config.engines[engine as EngineName].model, status: "error", error: (e as Error).message.slice(0, 500), latencyMs: Date.now() - started },
        });
      }
      done++;
      await setStage(auditId, "querying", `Asking ${engines.length} AI engine(s) ${active.length} questions (${done}/${jobs.length})`);
    });

    // 5. Explain the gaps with evidence.
    await setStage(auditId, "analyzing", "Comparing you with the businesses and sources AI chose");
    const gapFindings = await analyzeGaps({ runs: gapRuns, profile, siteDomain: audit.domain, sitePages: pages, topN: TOP_N });
    await saveFindings(auditId, gapFindings);

    const runs = await db.engineRun.findMany({ where: { auditId } });
    const top3 = perEngineRate(runs, (r) => r.brandPosition !== null && r.brandPosition <= 3);
    const top5 = perEngineRate(runs, (r) => r.brandPosition !== null && r.brandPosition <= TOP_N);
    const cited = perEngineRate(runs, (r) => r.brandCited);
    const engineSummary = Object.fromEntries(
      Object.keys(top5.byEngine).map((e) => [e, {
        top3: top3.byEngine[e],
        top5: top5.byEngine[e],
        cited: cited.byEngine[e],
        runs: runs.filter((r) => r.engine === e && r.status === "ok").length,
        errors: runs.filter((r) => r.engine === e && r.status === "error").length,
      }]),
    );
    const errorsOnly = runs.length > 0 && runs.every((r) => r.status === "error");

    // Without measured visibility an overall score would just be a scaled readability score, so leave it empty.
    const overall = top5.overall === null ? null : Math.round(top5.overall * 100 * 0.65 + readability * 0.35);

    await db.audit.update({
      where: { id: auditId },
      data: {
        status: errorsOnly ? "failed" : "done",
        stage: errorsOnly ? "Every AI engine request failed; check API keys and the run errors below." : "Audit complete",
        error: errorsOnly ? runs[0]?.error : null,
        visibilityTop3: top3.overall,
        visibilityTop5: top5.overall,
        citationRate: cited.overall,
        overallScore: overall,
        engineSummary: JSON.stringify(engineSummary),
        completedAt: new Date(),
      },
    });
  } catch (e) {
    console.error(`[audit ${auditId}]`, e);
    void track({ type: "error", level: "error", operation: currentStage.get(auditId)?.status, message: (e as Error).message, data: { stack: (e as Error).stack?.slice(0, 4000) ?? null } });
    await db.audit.update({ where: { id: auditId }, data: { status: "failed", error: (e as Error).message.slice(0, 1000), completedAt: new Date() } });
    await db.user.update({ where: { id: audit.userId }, data: { auditCredits: { increment: 1 } } });
  }
}
