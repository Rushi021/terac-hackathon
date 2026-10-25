import { llmAvailable, llmJson } from "../llm";
import { bareDomain } from "./fetcher";
import type { BusinessProfile, PageSignals } from "./types";

export async function buildProfile(domain: string, pages: PageSignals[]): Promise<BusinessProfile> {
  if (!llmAvailable()) return heuristicProfile(domain, pages);

  const corpus = pages
    .map((p) => `URL: ${p.finalUrl}\nTITLE: ${p.title}\nDESCRIPTION: ${p.description}\nH1: ${p.h1.join(" | ")}\nH2: ${p.h2.slice(0, 12).join(" | ")}\nTEXT: ${p.text.slice(0, 3000)}`)
    .join("\n\n---\n\n")
    .slice(0, 24_000);

  const result = await llmJson<Omit<BusinessProfile, "source">>(
    `You analyse a business website and describe the business factually. Only use information present in the pages. Return JSON:
{
 "businessName": string,
 "aliases": string[] (other names/spellings the business goes by, including the domain name without TLD),
 "category": string (plain generic category a customer would use, e.g. "emergency plumber", "vegan bakery", "B2B payroll software"),
 "services": string[] (up to 8 generic offerings, no brand names),
 "targetCustomers": string,
 "location": {"city": string|null, "region": string|null, "country": string|null, "isLocal": boolean (true if customers must be in a specific area)},
 "seedKeywords": string[] (6-10 generic 2-4 word phrases customers would search for this kind of business, NEVER containing the business name),
 "summary": string (2 sentences)
}`,
    `Domain: ${domain}\n\n${corpus}`,
  );
  return { ...result, aliases: result.aliases ?? [], seedKeywords: result.seedKeywords ?? [], services: result.services ?? [], source: "llm" };
}

function heuristicProfile(domain: string, pages: PageSignals[]): BusinessProfile {
  const home = pages[0];
  const name = home?.ogSiteName || home?.title.split(/[|\-–—:]/)[0]?.trim() || bareDomain(domain).split(".")[0];
  const category = home?.h1[0] || home?.description.split(/[.,]/)[0] || "business";
  return {
    businessName: name,
    aliases: [bareDomain(domain).split(".")[0]],
    category,
    services: pages.flatMap((p) => p.h2).slice(0, 6),
    targetCustomers: "",
    location: { city: null, region: null, country: null, isLocal: false },
    seedKeywords: [category.toLowerCase()].filter(Boolean),
    summary: home?.description ?? "",
    source: "heuristic",
  };
}
