import { config } from "../config";
import { timed } from "../observe";

export type KeywordVolume = { keyword: string; monthlyVolume: number | null; source: string | null };

/**
 * Monthly search demand per keyword. Uses Google Ads volumes via DataForSEO as
 * a proxy for AI-assistant demand (no public source exposes AI prompt volumes).
 * Returns null volumes when no provider is configured rather than guessing.
 */
export async function keywordVolumes(keywords: string[], country: string | null): Promise<KeywordVolume[]> {
  const unique = [...new Set(keywords.map((k) => k.toLowerCase().trim()).filter(Boolean))].slice(0, 50);
  const { login, password } = config.dataforseo;
  if (!login || !password || !unique.length) return unique.map((keyword) => ({ keyword, monthlyVolume: null, source: null }));

  const task = await timed("dataforseo", "search_volume", async () => {
    const res = await fetch("https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([{ keywords: unique, location_name: country || "United States", language_code: "en" }]),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`DataForSEO ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      tasks?: { status_code: number; status_message: string; result?: { keyword: string; search_volume: number | null }[] }[];
    };
    const first = data.tasks?.[0];
    if (!first || first.status_code !== 20000) throw new Error(`DataForSEO: ${first?.status_message ?? "no task"}`);
    return first;
  }, { keywords: unique.length });
  const byKeyword = new Map((task.result ?? []).map((r) => [r.keyword.toLowerCase(), r.search_volume]));
  return unique.map((keyword) => ({
    keyword,
    monthlyVolume: byKeyword.get(keyword) ?? null,
    source: "dataforseo:google_ads",
  }));
}
