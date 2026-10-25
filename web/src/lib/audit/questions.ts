import { db, parseJson } from "../db";
import { llmAvailable, llmJson } from "../llm";
import type { KeywordVolume } from "./demand";
import type { BusinessProfile } from "./types";

export type GeneratedQuestion = {
  text: string;
  intent: "discovery" | "comparison" | "problem" | "local" | "pricing";
  seedKeyword: string | null;
  rejectedReason: string | null;
};

export type HumanGuidance = { realistic: string[]; unrealistic: string[]; suggested: string[]; responses: number };

/**
 * Aggregates question-relevance labels collected from real people (Terac
 * participants and in-app users). The generator is steered by these examples,
 * which is what makes a later audit measurably better than an earlier one.
 */
export async function loadHumanGuidance(limit = 300): Promise<HumanGuidance> {
  const rows = await db.feedback.findMany({
    where: { kind: "question_relevance" },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const votes = new Map<string, { yes: number; no: number }>();
  const suggested: string[] = [];
  for (const row of rows) {
    const p = parseJson<{ ratings?: { question: string; realistic: boolean }[]; suggestion?: string }>(row.payload, {});
    for (const r of p.ratings ?? []) {
      const v = votes.get(r.question) ?? { yes: 0, no: 0 };
      if (r.realistic) v.yes++;
      else v.no++;
      votes.set(r.question, v);
    }
    if (p.suggestion?.trim()) suggested.push(p.suggestion.trim());
  }
  const realistic: string[] = [];
  const unrealistic: string[] = [];
  for (const [q, v] of votes) {
    if (v.yes + v.no < 2) continue;
    if (v.yes / (v.yes + v.no) >= 0.7) realistic.push(q);
    else if (v.no / (v.yes + v.no) >= 0.5) unrealistic.push(q);
  }
  return { realistic: realistic.slice(0, 15), unrealistic: unrealistic.slice(0, 15), suggested: suggested.slice(0, 15), responses: rows.length };
}

/** Drops any question that names or hints at the audited business. */
export function biasFilter(question: string, profile: BusinessProfile, domain: string): string | null {
  const q = question.toLowerCase();
  const brandTerms = [profile.businessName, ...profile.aliases, domain.split(".")[0]]
    .map((t) => t?.toLowerCase().trim())
    .filter((t): t is string => !!t && t.length >= 3);
  const hit = brandTerms.find((t) => q.includes(t));
  return hit ? `mentions the business ("${hit}")` : null;
}

export async function generateQuestions(
  profile: BusinessProfile,
  volumes: KeywordVolume[],
  domain: string,
  count: number,
  guidance: HumanGuidance,
): Promise<GeneratedQuestion[]> {
  const ranked = [...volumes].sort((a, b) => (b.monthlyVolume ?? -1) - (a.monthlyVolume ?? -1));
  const where = [profile.location.city, profile.location.region, profile.location.country].filter(Boolean).join(", ");

  // Template questions built from scraped headings read like marketing copy and
  // often contain the brand, so without an LLM no questions are generated.
  if (!llmAvailable()) return [];

  let raw: GeneratedQuestion[];
  {
    // Deliberately withhold the business name, differentiators and site copy:
    // the generator only sees the generic category, so questions reflect what a
    // customer would ask, not what the site wants to rank for.
    const res = await llmJson<{ questions: { text: string; intent: GeneratedQuestion["intent"]; seedKeyword: string | null }[] }>(
      `You write the questions real customers type into AI assistants (ChatGPT, Perplexity, Gemini) when they need a product or service but have NOT chosen a provider yet.
Rules:
- Never mention any specific company, brand or website.
- Write how ordinary people talk: casual, specific needs, sometimes constraints (budget, timing, location). No marketing language.
- Each question must be answerable with a recommendation or comparison of providers, so the answer would name businesses.
- Spread intents: discovery ("best X"), comparison/alternatives, problem-led ("I need..."), pricing, and local if location matters.
- Weight topics by the search volumes given; higher volume topics get more questions.
Return JSON {"questions":[{"text","intent","seedKeyword"}]} with exactly ${count} questions.`,
      [
        `Category: ${profile.category}`,
        `Generic offerings: ${profile.services.join("; ")}`,
        `Typical customers: ${profile.targetCustomers}`,
        profile.location.isLocal ? `Customers are located in: ${where}` : `Market: ${where || "online / not location-bound"}`,
        `Topics with monthly search volume (null = unknown):\n${ranked.map((k) => `- ${k.keyword}: ${k.monthlyVolume ?? "null"}`).join("\n")}`,
        guidance.realistic.length ? `People confirmed these sound like real questions (match this style):\n${guidance.realistic.map((q) => `- ${q}`).join("\n")}` : "",
        guidance.suggested.length ? `Questions real people said they would ask instead:\n${guidance.suggested.map((q) => `- ${q}`).join("\n")}` : "",
        guidance.unrealistic.length ? `People said these do NOT sound like something they would ask (avoid this style):\n${guidance.unrealistic.map((q) => `- ${q}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      { temperature: 0.6 },
    );
    raw = res.questions.map((q) => ({ ...q, seedKeyword: q.seedKeyword ?? null, rejectedReason: null }));
  }

  const seen = new Set<string>();
  return raw
    .filter((q) => {
      const key = q.text.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((q) => ({ ...q, rejectedReason: biasFilter(q.text, profile, domain) }));
}
