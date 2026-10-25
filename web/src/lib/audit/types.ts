export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type EvidenceItem = { label: string; value: string };

export type FindingInput = {
  category: "crawl" | "rendering" | "content" | "schema" | "visibility" | "competitor";
  severity: Severity;
  title: string;
  evidence: EvidenceItem[];
  why: string;
  fix: string;
  impact: number;
};

export type BotAccess = {
  bot: string;
  owner: string;
  purpose: "search" | "user-fetch" | "training";
  robotsAllowed: boolean;
  robotsRule: string | null; // the exact robots.txt line that decided access
  liveStatus: number | null; // HTTP status when fetched with this bot's user agent
  liveBlocked: boolean;
  liveNote: string | null;
};

export type PageSignals = {
  url: string;
  finalUrl: string;
  status: number;
  ms: number;
  title: string;
  description: string;
  h1: string[];
  h2: string[];
  text: string;
  wordCount: number;
  jsonLdTypes: string[];
  hasFaq: boolean;
  canonical: string | null;
  metaRobots: string | null;
  xRobotsTag: string | null;
  lang: string | null;
  ogSiteName: string | null;
  spaShell: boolean;
  links: string[];
};

export type CrawlReport = {
  url: string;
  finalUrl: string;
  https: boolean;
  homepage: { status: number; ms: number; wordCount: number; spaShell: boolean } | null;
  robots: { found: boolean; status: number | null; sitemaps: string[]; raw: string | null };
  bots: BotAccess[];
  llmsTxt: { found: boolean; status: number | null };
  sitemap: { found: boolean; url: string | null; urlCount: number };
  blocked: boolean;
  blockedReasons: string[];
};

export type BusinessProfile = {
  businessName: string;
  aliases: string[];
  category: string;
  services: string[];
  targetCustomers: string;
  location: { city: string | null; region: string | null; country: string | null; isLocal: boolean };
  seedKeywords: string[];
  summary: string;
  source: "llm" | "heuristic";
};

export type Citation = { url: string; title: string | null; domain: string };
export type RankedEntity = { name: string; domain: string | null; position: number };
