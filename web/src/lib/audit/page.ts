import * as cheerio from "cheerio";
import { fetchPage, sameSite, type FetchResult } from "./fetcher";
import type { PageSignals } from "./types";

function collectJsonLdTypes($: cheerio.CheerioAPI): string[] {
  const types = new Set<string>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    if (typeof t === "string") types.add(t);
    if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(x));
    if (obj["@graph"]) visit(obj["@graph"]);
    for (const v of Object.values(obj)) if (typeof v === "object") visit(v);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      visit(JSON.parse($(el).text()));
    } catch {
      /* malformed JSON-LD is reported as absent */
    }
  });
  return [...types];
}

/** Signals as a non-JavaScript crawler sees them: raw HTML only, no rendering. */
export function extractSignals(url: string, res: FetchResult): PageSignals {
  const $ = cheerio.load(res.body || "");
  const jsonLdTypes = collectJsonLdTypes($);
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    try {
      const href = new URL($(el).attr("href")!, res.finalUrl);
      href.hash = "";
      if (/^https?:$/.test(href.protocol)) links.add(href.toString());
    } catch {
      /* ignore unparsable hrefs */
    }
  });

  const rootEmpty = ["#root", "#__next", "#app", "#__nuxt"].some((sel) => {
    const el = $(sel);
    return el.length > 0 && el.text().trim().length < 50;
  });

  $("script, style, noscript, svg, template, iframe").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = text ? text.split(" ").length : 0;
  const scriptCount = (res.body.match(/<script\b/gi) ?? []).length;

  const faqHeadings = $("h2, h3, summary, dt")
    .toArray()
    .filter((el) => /\?\s*$/.test($(el).text().trim())).length;

  return {
    url,
    finalUrl: res.finalUrl,
    status: res.status,
    ms: res.ms,
    title: $("title").first().text().trim(),
    description: $('meta[name="description"]').attr("content")?.trim() ?? "",
    h1: $("h1").toArray().map((el) => $(el).text().replace(/\s+/g, " ").trim()).filter(Boolean),
    h2: $("h2").toArray().map((el) => $(el).text().replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 30),
    text: text.slice(0, 20_000),
    wordCount,
    jsonLdTypes,
    hasFaq: jsonLdTypes.includes("FAQPage") || faqHeadings >= 3,
    canonical: $('link[rel="canonical"]').attr("href") ?? null,
    metaRobots: $('meta[name="robots"]').attr("content") ?? null,
    xRobotsTag: res.headers?.get("x-robots-tag") ?? null,
    lang: $("html").attr("lang") ?? null,
    ogSiteName: $('meta[property="og:site_name"]').attr("content") ?? null,
    spaShell: wordCount < 150 && (rootEmpty || scriptCount > 10),
    links: [...links],
  };
}

export async function fetchSignals(url: string, userAgent?: string) {
  const res = await fetchPage(url, userAgent);
  return { res, signals: extractSignals(url, res) };
}

const PRIORITY = /about|service|product|pricing|price|menu|faq|contact|location|team|solution|what-we-do|treatment|feature/i;

/** Picks the internal pages most likely to describe the business. */
export function pickInternalPages(home: PageSignals, sitemapUrls: string[], max: number): string[] {
  const candidates = [...home.links, ...sitemapUrls].filter(
    (u) => sameSite(u, home.finalUrl) && !/\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|mp4)$/i.test(u) && !/[?#]/.test(u),
  );
  const unique = [...new Set(candidates)].filter((u) => u.replace(/\/$/, "") !== home.finalUrl.replace(/\/$/, ""));
  const scored = unique
    .map((u) => ({ u, score: (PRIORITY.test(new URL(u).pathname) ? 10 : 0) - new URL(u).pathname.split("/").length }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.u);
}
