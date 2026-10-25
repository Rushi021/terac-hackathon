import { ENGINE_LABELS } from "./engines";
import { mapLimit, sameSite } from "./fetcher";
import { fetchSignals } from "./page";
import type { BusinessProfile, Citation, FindingInput, PageSignals, RankedEntity } from "./types";
import type { EngineName } from "../config";

export type RunForGaps = {
  engine: EngineName;
  question: string;
  status: string;
  brandPosition: number | null;
  brandCited: boolean;
  entities: RankedEntity[];
  citations: Citation[];
};

const DIRECTORIES = /yelp|tripadvisor|g2\.com|capterra|trustpilot|reddit|clutch\.co|angi|thumbtack|houzz|bbb\.org|yellowpages|google\.com\/maps|opentable|zocdoc|healthgrades|avvo|nerdwallet|forbes|wikipedia|youtube|quora|facebook|instagram|linkedin|tiktok/i;

const STOP = new Set("a an the and or for to of in on with my me i is are what which who best good top near can you do does how much should get find recommend recommended any some that this from at by be it your".split(" "));

const terms = (s: string) => [...new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))];

function coverage(text: string, words: string[]) {
  const t = text.toLowerCase();
  const hits = words.filter((w) => t.includes(w));
  return { hits, missing: words.filter((w) => !hits.includes(w)), ratio: words.length ? hits.length / words.length : 1 };
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export async function analyzeGaps(opts: {
  runs: RunForGaps[];
  profile: BusinessProfile;
  siteDomain: string;
  sitePages: PageSignals[];
  topN: number;
}): Promise<FindingInput[]> {
  const { runs, profile, siteDomain, sitePages, topN } = opts;
  const ok = runs.filter((r) => r.status === "ok");
  if (!ok.length) return [];
  const findings: FindingInput[] = [];
  const losing = ok.filter((r) => r.brandPosition === null || r.brandPosition > topN);
  const siteText = sitePages.map((p) => `${p.title} ${p.description} ${p.h1.join(" ")} ${p.h2.join(" ")} ${p.text}`).join(" ");

  // 1. Per-question outcome, grouped so each question shows every engine's result.
  const byQuestion = new Map<string, RunForGaps[]>();
  for (const r of ok) byQuestion.set(r.question, [...(byQuestion.get(r.question) ?? []), r]);
  for (const [question, qRuns] of byQuestion) {
    const lost = qRuns.filter((r) => r.brandPosition === null || r.brandPosition > topN);
    if (!lost.length) continue;
    const q = terms(question);
    const cov = coverage(siteText, q);
    findings.push({
      category: "visibility",
      severity: lost.length === qRuns.length ? "high" : "medium",
      title: `Not in the top ${topN} for “${question}”`,
      evidence: [
        ...lost.map((r) => ({
          label: ENGINE_LABELS[r.engine],
          value: `${r.brandPosition ? `You ranked #${r.brandPosition}` : "You were not mentioned"}. Ranked: ${
            r.entities.slice(0, topN).map((e) => `#${e.position} ${e.name}`).join(", ") || "(no businesses named)"
          }`,
        })),
        { label: "Question terms your site never uses", value: cov.missing.join(", ") || "(none — all terms present)" },
      ],
      why:
        cov.ratio < 0.6
          ? `Your pages do not use ${cov.missing.length} of the ${q.length} key terms in this question, so retrieval systems are unlikely to match your pages to it.`
          : "Your pages cover the question's terms, so the gap is more likely authority (third-party mentions/reviews) or page structure than wording; see competitor findings.",
      fix:
        cov.ratio < 0.6
          ? `Create or extend a page that directly answers “${question}” and naturally uses: ${cov.missing.join(", ")}.`
          : "Get listed on the sources these engines cite for this question and add a page section that answers it directly in the first paragraph.",
      impact: 0,
    });
  }

  // 2. Who wins instead.
  const competitorWins = new Map<string, { count: number; engines: Set<string> }>();
  for (const r of losing) {
    for (const e of r.entities.slice(0, topN)) {
      if (e.domain && sameSite(e.domain, siteDomain)) continue;
      const v = competitorWins.get(e.name) ?? { count: 0, engines: new Set() };
      v.count++;
      v.engines.add(ENGINE_LABELS[r.engine]);
      competitorWins.set(e.name, v);
    }
  }
  const topCompetitors = [...competitorWins.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 8);
  if (topCompetitors.length) {
    findings.push({
      category: "competitor",
      severity: "info",
      title: "Businesses AI recommends instead of you",
      evidence: topCompetitors.map(([name, v]) => ({ label: name, value: `In the top ${topN} ${v.count}× (${[...v.engines].join(", ")})` })),
      why: "These are the providers answer engines currently consider the best match for your customers' questions.",
      fix: "Study the pages and listings cited for them (next findings) and close the specific gaps.",
      impact: 0,
    });
  }

  // 3. Sources the engines rely on, split into directories/lists and competitor sites.
  const citeCount = new Map<string, { c: Citation; n: number }>();
  for (const r of losing) for (const c of r.citations) {
    if (sameSite(c.domain, siteDomain)) continue;
    const v = citeCount.get(c.url) ?? { c, n: 0 };
    v.n++;
    citeCount.set(c.url, v);
  }
  const topSources = [...citeCount.values()].sort((a, b) => b.n - a.n).filter((s) => !/vertexaisearch|grounding-api-redirect/.test(s.c.url));
  const directorySources = topSources.filter((s) => DIRECTORIES.test(s.c.domain)).slice(0, 4);
  const competitorSources = topSources.filter((s) => !DIRECTORIES.test(s.c.domain)).slice(0, 3);

  const fetched = await mapLimit([...directorySources, ...competitorSources], 3, async (s) => ({ s, ...(await fetchSignals(s.c.url)) }));
  const names = [profile.businessName, ...profile.aliases].filter((n) => n && n.length >= 3).map((n) => n.toLowerCase());

  const missingFromLists = fetched.filter((f) => DIRECTORIES.test(f.s.c.domain) && f.res.ok && !names.some((n) => f.signals.text.toLowerCase().includes(n)));
  if (missingFromLists.length) {
    findings.push({
      category: "competitor",
      severity: "high",
      title: "You are absent from the lists AI engines cite",
      evidence: missingFromLists.map((f) => ({
        label: `${f.s.c.domain} (cited ${f.s.n}×)`,
        value: `${f.s.c.url} — fetched it; “${profile.businessName}” does not appear on the page`,
      })),
      why: "For recommendation questions, answer engines lean on directories, review sites and roundup articles. If you are not on those pages, you cannot be pulled into the answer.",
      fix: "Claim/complete your profile on these platforms, collect reviews there, and pitch the roundup authors to include you.",
      impact: 0,
    });
  }

  // 4. Page-level comparison against competitor pages that were cited.
  const compPages = fetched.filter((f) => !DIRECTORIES.test(f.s.c.domain) && f.res.ok && f.signals.wordCount > 0).map((f) => f.signals);
  if (compPages.length && sitePages.length) {
    const yourBest = [...sitePages].sort((a, b) => b.wordCount - a.wordCount)[0];
    const compWords = median(compPages.map((p) => p.wordCount));
    const compSchema = compPages.filter((p) => p.jsonLdTypes.length).length;
    const compFaq = compPages.filter((p) => p.hasFaq).length;
    const evidence = [
      { label: "Your most detailed page", value: `${yourBest.finalUrl} — ${yourBest.wordCount} words, schema: ${yourBest.jsonLdTypes.join(", ") || "none"}, FAQ: ${yourBest.hasFaq ? "yes" : "no"}` },
      ...compPages.map((p) => ({ label: "Cited competitor page", value: `${p.finalUrl} — ${p.wordCount} words, schema: ${p.jsonLdTypes.join(", ") || "none"}, FAQ: ${p.hasFaq ? "yes" : "no"}` })),
    ];
    const gaps: string[] = [];
    if (compWords > yourBest.wordCount * 1.5) gaps.push(`cited pages are longer (median ${compWords} words vs your ${yourBest.wordCount})`);
    if (compSchema > compPages.length / 2 && !yourBest.jsonLdTypes.length) gaps.push(`${compSchema}/${compPages.length} use structured data, you do not`);
    if (compFaq > compPages.length / 2 && !sitePages.some((p) => p.hasFaq)) gaps.push(`${compFaq}/${compPages.length} answer questions in FAQ form, you have no FAQ`);
    if (gaps.length) {
      findings.push({
        category: "content",
        severity: "medium",
        title: "Cited competitor pages are structured to be quoted",
        evidence,
        why: `Measured differences: ${gaps.join("; ")}.`,
        fix: "Add a service page per main offering with a direct one-paragraph answer at the top, specifics (prices, areas, timings), an FAQ section with FAQPage schema, and Organization/LocalBusiness schema.",
        impact: 0,
      });
    }
  }

  return findings;
}
