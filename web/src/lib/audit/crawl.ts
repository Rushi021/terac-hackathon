import { BROWSER_UA, fetchPage, mapLimit } from "./fetcher";
import { extractSignals } from "./page";
import { evaluateRobots, parseRobots } from "./robots";
import type { BotAccess, CrawlReport, FindingInput, PageSignals } from "./types";

type BotDef = { bot: string; owner: string; purpose: BotAccess["purpose"]; ua: string | null };

// "search" and "user-fetch" bots decide whether a site can appear in AI answers.
// "training" bots only affect model training; blocking them is a business choice.
export const AI_BOTS: BotDef[] = [
  { bot: "OAI-SearchBot", owner: "OpenAI (ChatGPT search)", purpose: "search", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot" },
  { bot: "ChatGPT-User", owner: "OpenAI (live browsing)", purpose: "user-fetch", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot" },
  { bot: "PerplexityBot", owner: "Perplexity", purpose: "search", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)" },
  { bot: "Perplexity-User", owner: "Perplexity (live fetch)", purpose: "user-fetch", ua: null },
  { bot: "Claude-SearchBot", owner: "Anthropic (Claude search)", purpose: "search", ua: null },
  { bot: "Claude-User", owner: "Anthropic (live fetch)", purpose: "user-fetch", ua: null },
  { bot: "Googlebot", owner: "Google (Search, AI Overviews, Gemini grounding)", purpose: "search", ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
  { bot: "Bingbot", owner: "Microsoft (Bing, Copilot; feeds ChatGPT search)", purpose: "search", ua: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" },
  { bot: "GPTBot", owner: "OpenAI (training)", purpose: "training", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot" },
  { bot: "ClaudeBot", owner: "Anthropic (training)", purpose: "training", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)" },
  { bot: "Google-Extended", owner: "Google (Gemini training)", purpose: "training", ua: null },
  { bot: "CCBot", owner: "Common Crawl (used by many models)", purpose: "training", ua: null },
];

const CHALLENGE = /just a moment|cf-chl|attention required|captcha|access denied|are you a robot|enable javascript and cookies/i;

function isChallenge(status: number, body: string) {
  return [401, 403, 429, 503].includes(status) || (body.length < 20_000 && CHALLENGE.test(body));
}

export async function runCrawlChecks(startUrl: URL): Promise<{
  report: CrawlReport;
  home: PageSignals | null;
  findings: FindingInput[];
  sitemapUrls: string[];
}> {
  const findings: FindingInput[] = [];
  const origin = startUrl.origin;

  const [homeRes, robotsRes, llmsRes] = await Promise.all([
    fetchPage(startUrl.toString(), BROWSER_UA),
    fetchPage(`${origin}/robots.txt`, BROWSER_UA, 10_000),
    fetchPage(`${origin}/llms.txt`, BROWSER_UA, 10_000),
  ]);

  const home = homeRes.status > 0 ? extractSignals(startUrl.toString(), homeRes) : null;
  const robotsFound = robotsRes.ok && !/<html/i.test(robotsRes.body.slice(0, 500));
  const robots = parseRobots(robotsFound ? robotsRes.body : "");

  const liveByBot = new Map<string, { status: number; blocked: boolean; note: string | null }>();
  const liveBots = AI_BOTS.filter((b) => b.ua);
  await mapLimit(liveBots, 4, async (b) => {
    const r = await fetchPage(startUrl.toString(), b.ua!, 12_000);
    const blocked = r.status === 0 || isChallenge(r.status, r.body);
    const browserOk = homeRes.ok && !isChallenge(homeRes.status, homeRes.body);
    liveByBot.set(b.bot, {
      status: r.status,
      blocked: blocked && browserOk,
      note: r.error ?? (blocked && browserOk ? `Browser got ${homeRes.status}, ${b.bot} user agent got ${r.status}` : null),
    });
  });

  const bots: BotAccess[] = AI_BOTS.map((b) => {
    const verdict = evaluateRobots(robots, b.bot, new URL(homeRes.finalUrl || startUrl.toString()).pathname || "/");
    const live = liveByBot.get(b.bot);
    return {
      bot: b.bot,
      owner: b.owner,
      purpose: b.purpose,
      robotsAllowed: verdict.allowed,
      robotsRule: verdict.rule,
      liveStatus: live?.status ?? null,
      liveBlocked: live?.blocked ?? false,
      liveNote: live?.note ?? null,
    };
  });

  // Sitemap
  const sitemapCandidates = robots.sitemaps.length ? robots.sitemaps : [`${origin}/sitemap.xml`];
  let sitemap = { found: false, url: null as string | null, urlCount: 0, urls: [] as string[] };
  for (const sm of sitemapCandidates.slice(0, 2)) {
    const r = await fetchPage(sm, BROWSER_UA, 10_000);
    if (r.ok && /<(urlset|sitemapindex)/i.test(r.body)) {
      const urls = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
      sitemap = { found: true, url: sm, urlCount: urls.length, urls };
      break;
    }
  }

  const blockedReasons: string[] = [];

  // ---- Reachability
  if (!homeRes.ok) {
    const botWall = isChallenge(homeRes.status, homeRes.body);
    blockedReasons.push(`Homepage returned ${homeRes.status || homeRes.error}`);
    findings.push({
      category: "crawl",
      severity: "critical",
      title: botWall ? "Homepage rejects automated requests" : "Homepage is not reachable",
      evidence: [
        { label: "URL", value: startUrl.toString() },
        { label: "Result", value: homeRes.error ?? `HTTP ${homeRes.status}` },
        ...(botWall ? [{ label: "Response starts with", value: homeRes.body.replace(/\s+/g, " ").slice(0, 160) }] : []),
      ],
      why: botWall
        ? "A server-side request with a normal browser user agent was refused, which is what bot protection does to crawlers that cannot run JavaScript challenges. AI crawlers fetch the same way, so they most likely get the same refusal."
        : "If the page does not load for an ordinary request, no AI crawler can read it, so the site cannot be cited.",
      fix: botWall
        ? "In your CDN/WAF, stop challenging verified search and AI crawlers (Cloudflare: Security → Bots; allow \"Verified bots\" and AI search crawlers). Check the firewall event log for blocked requests from OpenAI, Perplexity, Google and Bing."
        : "Make sure the domain resolves and the homepage returns HTTP 200 over HTTPS without requiring login or a JavaScript challenge.",
      impact: 60,
    });
  }

  // ---- Indexing directives
  const noindex = [home?.metaRobots, home?.xRobotsTag].some((v) => v && /noindex|none/i.test(v));
  if (noindex) {
    blockedReasons.push("Homepage is marked noindex");
    findings.push({
      category: "crawl",
      severity: "critical",
      title: "Homepage tells search engines not to index it",
      evidence: [
        { label: "meta robots", value: home?.metaRobots ?? "(none)" },
        { label: "X-Robots-Tag header", value: home?.xRobotsTag ?? "(none)" },
      ],
      why: "Google and Bing drop noindex pages from their index. ChatGPT search, Copilot, Gemini and AI Overviews draw on those indexes, so the page will not be retrieved.",
      fix: 'Remove "noindex" from the robots meta tag and the X-Robots-Tag response header (often a leftover staging setting in the CMS or SEO plugin).',
      impact: 50,
    });
  }
  const nosnippet = [home?.metaRobots, home?.xRobotsTag].some((v) => v && /nosnippet|max-snippet:\s*0/i.test(v));
  if (nosnippet) {
    findings.push({
      category: "crawl",
      severity: "high",
      title: "Snippets are disabled",
      evidence: [{ label: "Directive", value: home?.metaRobots ?? home?.xRobotsTag ?? "" }],
      why: "Google documents that nosnippet also prevents content from being used in AI Overviews.",
      fix: "Remove nosnippet / max-snippet:0 unless you deliberately want to be excluded from AI answers.",
      impact: 15,
    });
  }

  // ---- robots.txt per bot
  const searchBots = bots.filter((b) => b.purpose !== "training");
  const robotsBlockedSearch = searchBots.filter((b) => !b.robotsAllowed);
  if (robotsBlockedSearch.length) {
    const allCore = ["OAI-SearchBot", "PerplexityBot", "Googlebot", "Bingbot"].every((name) =>
      robotsBlockedSearch.some((b) => b.bot === name),
    );
    if (allCore) blockedReasons.push("robots.txt blocks all major AI search crawlers");
    findings.push({
      category: "crawl",
      severity: allCore ? "critical" : "high",
      title: `robots.txt blocks ${robotsBlockedSearch.length} AI search crawler${robotsBlockedSearch.length > 1 ? "s" : ""}`,
      evidence: robotsBlockedSearch.map((b) => ({ label: `${b.bot} — ${b.owner}`, value: b.robotsRule ?? "Disallowed" })),
      why: "These crawlers fetch pages to build the indexes AI assistants search when answering. A blocked crawler cannot retrieve or cite your pages.",
      fix: `Add an explicit allow group to ${origin}/robots.txt, e.g.\n\n${robotsBlockedSearch
        .map((b) => `User-agent: ${b.bot}`)
        .join("\n")}\nAllow: /`,
      impact: Math.min(45, robotsBlockedSearch.length * 8),
    });
  }
  const robotsBlockedTraining = bots.filter((b) => b.purpose === "training" && !b.robotsAllowed);
  if (robotsBlockedTraining.length) {
    findings.push({
      category: "crawl",
      severity: "info",
      title: "Model-training crawlers are blocked",
      evidence: robotsBlockedTraining.map((b) => ({ label: b.bot, value: b.robotsRule ?? "Disallowed" })),
      why: "These bots collect training data. Blocking them does not remove you from AI search answers, but models will know less about your business from their own memory.",
      fix: "Keep this if it is a deliberate choice. Otherwise allow them so models learn your brand facts.",
      impact: 0,
    });
  }

  // ---- Firewall / bot protection (simulated with each bot's user agent)
  const fwBlocked = bots.filter((b) => b.liveBlocked && b.purpose !== "training");
  if (fwBlocked.length) {
    if (fwBlocked.length >= 3) blockedReasons.push("Firewall rejects AI crawler user agents");
    findings.push({
      category: "crawl",
      severity: fwBlocked.length >= 3 ? "critical" : "high",
      title: "Your firewall or CDN rejects AI crawlers",
      evidence: fwBlocked.map((b) => ({ label: b.bot, value: b.liveNote ?? `HTTP ${b.liveStatus}` })),
      why: "robots.txt may allow these bots, but the server blocks them before they see any content. This is common with Cloudflare's \"Block AI bots\" setting and aggressive bot-fight modes.",
      fix: "In your CDN/WAF (e.g. Cloudflare → Security → Bots), allow verified AI search crawlers. Note: this test sends each bot's user agent from our server, not from the bot's own IP range, so a WAF that verifies IPs may treat real crawlers differently; confirm in your firewall event log.",
      impact: Math.min(40, fwBlocked.length * 10),
    });
  }

  // ---- Rendering
  if (home && homeRes.ok) {
    if (home.spaShell || home.wordCount < 150) {
      findings.push({
        category: "rendering",
        severity: home.wordCount < 50 ? "critical" : "high",
        title: "Most content only appears after JavaScript runs",
        evidence: [
          { label: "Words in raw HTML", value: String(home.wordCount) },
          { label: "Empty app root detected", value: home.spaShell ? "yes" : "no" },
          { label: "Text crawlers see", value: home.text.slice(0, 240) || "(empty)" },
        ],
        why: "Most AI crawlers (OpenAI, Anthropic, Perplexity) do not execute JavaScript. They read the raw HTML, which here contains almost no text about your business.",
        fix: "Serve the main content in the initial HTML: enable server-side rendering or static generation (Next.js, Nuxt, Astro), or use your site builder's prerender option.",
        impact: home.wordCount < 50 ? 30 : 20,
      });
    } else if (home.wordCount < 300) {
      findings.push({
        category: "content",
        severity: "medium",
        title: "Homepage has thin text content",
        evidence: [{ label: "Words in raw HTML", value: String(home.wordCount) }],
        why: "Answer engines quote and summarise text. With few words there is little for them to extract about what you do, where, and for whom.",
        fix: "Add a plain-language section: what you offer, who it is for, where you operate, prices or ranges, and what makes you different.",
        impact: 8,
      });
    }
    if (homeRes.ms > 3000) {
      findings.push({
        category: "crawl",
        severity: "medium",
        title: "Slow server response",
        evidence: [{ label: "Homepage load (server-side fetch)", value: `${homeRes.ms} ms` }],
        why: "Live-fetch bots such as ChatGPT-User fetch pages while the user waits and abandon slow responses.",
        fix: "Enable caching/CDN for HTML and reduce server work so the page responds in under 1–2 seconds.",
        impact: 6,
      });
    }
    if (!home.title || !home.description) {
      findings.push({
        category: "content",
        severity: "low",
        title: "Missing title or meta description",
        evidence: [
          { label: "Title", value: home.title || "(missing)" },
          { label: "Meta description", value: home.description || "(missing)" },
        ],
        why: "Search indexes and AI retrieval use these as the summary of the page.",
        fix: "Write a title like \"<Service> in <City> | <Business>\" and a one-sentence description of what you do and for whom.",
        impact: 4,
      });
    }
    const orgTypes = home.jsonLdTypes.filter((t) => /Organization|LocalBusiness|Store|Restaurant|Service|Product|Professional|Clinic|Dentist|Attorney|Corporation/i.test(t));
    if (!orgTypes.length) {
      findings.push({
        category: "schema",
        severity: "medium",
        title: "No business structured data (schema.org)",
        evidence: [{ label: "JSON-LD types found", value: home.jsonLdTypes.join(", ") || "(none)" }],
        why: "Structured data states your name, category, address, hours and offerings in a machine-readable way, which reduces the chance an AI gets basic facts wrong.",
        fix: "Add Organization or LocalBusiness JSON-LD with name, url, logo, address, telephone, areaServed, sameAs (social/profile links).",
        impact: 8,
      });
    }
  }

  if (!startUrl.protocol.startsWith("https")) {
    findings.push({
      category: "crawl",
      severity: "low",
      title: "Site not served over HTTPS",
      evidence: [{ label: "URL", value: startUrl.toString() }],
      why: "Search engines prefer HTTPS and some fetchers refuse plain HTTP.",
      fix: "Install a TLS certificate and redirect HTTP to HTTPS.",
      impact: 3,
    });
  }

  if (!sitemap.found) {
    findings.push({
      category: "crawl",
      severity: "low",
      title: "No XML sitemap found",
      evidence: [{ label: "Checked", value: sitemapCandidates.join(", ") }],
      why: "Sitemaps help crawlers discover deeper pages (services, locations, FAQs) that are not linked from the homepage.",
      fix: `Publish ${origin}/sitemap.xml and reference it in robots.txt with "Sitemap: ${origin}/sitemap.xml".`,
      impact: 3,
    });
  }

  const llmsFound = llmsRes.ok && !/<html/i.test(llmsRes.body.slice(0, 500));
  if (!llmsFound) {
    findings.push({
      category: "crawl",
      severity: "info",
      title: "No llms.txt file",
      evidence: [{ label: "Checked", value: `${origin}/llms.txt → ${llmsRes.status}` }],
      why: "llms.txt is a proposed convention for giving AI agents a curated map of your site. Major answer engines have not confirmed they use it, so this is optional.",
      fix: "Optional: add /llms.txt listing your key pages with one-line descriptions.",
      impact: 0,
    });
  }

  const report: CrawlReport = {
    url: startUrl.toString(),
    finalUrl: homeRes.finalUrl,
    https: startUrl.protocol === "https:",
    homepage: home ? { status: homeRes.status, ms: homeRes.ms, wordCount: home.wordCount, spaShell: home.spaShell } : null,
    robots: { found: robotsFound, status: robotsRes.status || null, sitemaps: robots.sitemaps, raw: robotsFound ? robotsRes.body.slice(0, 5000) : null },
    bots,
    llmsTxt: { found: llmsFound, status: llmsRes.status || null },
    sitemap: { found: sitemap.found, url: sitemap.url, urlCount: sitemap.urlCount },
    blocked: blockedReasons.length > 0,
    blockedReasons,
  };

  return { report, home, findings, sitemapUrls: sitemap.urls.slice(0, 200) };
}

export function readabilityScore(findings: FindingInput[]) {
  const lost = findings.reduce((sum, f) => sum + f.impact, 0);
  return Math.max(0, Math.min(100, 100 - lost));
}
