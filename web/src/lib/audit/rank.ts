import { llmAvailable, llmJson } from "../llm";
import { bareDomain, sameSite } from "./fetcher";
import type { BusinessProfile, Citation, RankedEntity } from "./types";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Businesses recommended in an answer, in order of first appearance. */
export async function extractEntities(question: string, answer: string, citations: Citation[]): Promise<RankedEntity[]> {
  if (!answer.trim()) return [];
  if (llmAvailable()) {
    const res = await llmJson<{ entities: { name: string; domain: string | null }[] }>(
      `Extract the businesses, brands or providers that an AI answer presents as options for the user's question, in the order they first appear. Exclude publishers or directories that are only sources (e.g. "according to Yelp") unless the answer recommends them as the provider. Use a domain only if the answer text or citation list makes it clear. Return JSON {"entities":[{"name","domain"}]}.`,
      `Question: ${question}\n\nAnswer:\n${answer.slice(0, 12_000)}\n\nCitations:\n${citations.map((c) => `${c.title ?? ""} ${c.url}`).join("\n")}`,
      { temperature: 0 },
    );
    return (res.entities ?? []).map((e, i) => ({ name: e.name, domain: e.domain ? bareDomain(e.domain) : null, position: i + 1 }));
  }
  // Without an LLM, approximate the ranking by citation order.
  const domains = [...new Set(citations.map((c) => c.domain))];
  return domains.map((d, i) => ({ name: d, domain: d, position: i + 1 }));
}

export function locateBrand(entities: RankedEntity[], answer: string, citations: Citation[], profile: BusinessProfile, siteDomain: string) {
  const names = [profile.businessName, ...profile.aliases].map(norm).filter((n) => n.length >= 3);
  const match = entities.find(
    (e) => {
      const entity = norm(e.name);
      return (
        (e.domain && sameSite(e.domain, siteDomain)) ||
        names.some((n) => entity.includes(n) || (entity.length >= 4 && n.includes(entity)))
      );
    },
  );
  const mentioned = !!match || names.some((n) => norm(answer).includes(n));
  return {
    position: match?.position ?? null,
    mentioned,
    cited: citations.some((c) => sameSite(c.domain, siteDomain)),
  };
}
