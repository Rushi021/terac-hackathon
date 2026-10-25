import { config, type EngineName } from "../config";
import { timed } from "../observe";
import { bareDomain } from "./fetcher";
import type { Citation } from "./types";

export type EngineAnswer = { text: string; citations: Citation[]; model: string };

const toCitation = (url: string, title: string | null = null): Citation => ({ url, title, domain: bareDomain(url) });

function dedupe(citations: Citation[]) {
  const seen = new Set<string>();
  return citations.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
}

async function post(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// The question is sent verbatim with no system prompt, so the answer matches
// what a user typing the same question would get.

async function askOpenAI(question: string): Promise<EngineAnswer> {
  const { apiKey, model } = config.engines.openai;
  const data = await post("https://api.openai.com/v1/responses", { authorization: `Bearer ${apiKey}` }, {
    model,
    input: question,
    tools: [{ type: "web_search" }],
  });
  let text = "";
  const citations: Citation[] = [];
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type !== "output_text") continue;
      text += part.text;
      for (const a of part.annotations ?? []) if (a.type === "url_citation") citations.push(toCitation(a.url, a.title ?? null));
    }
  }
  return { text, citations: dedupe(citations), model };
}

async function askPerplexity(question: string): Promise<EngineAnswer> {
  const { apiKey, model } = config.engines.perplexity;
  const data = await post("https://api.perplexity.ai/chat/completions", { authorization: `Bearer ${apiKey}` }, {
    model,
    messages: [{ role: "user", content: question }],
  });
  const results: { url: string; title?: string }[] = data.search_results ?? [];
  const urls: string[] = data.citations ?? results.map((r) => r.url);
  const titles = new Map(results.map((r) => [r.url, r.title ?? null]));
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    citations: dedupe(urls.map((u) => toCitation(u, titles.get(u) ?? null))),
    model,
  };
}

async function askGemini(question: string): Promise<EngineAnswer> {
  const { apiKey, model } = config.engines.gemini;
  const data = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { "x-goog-api-key": apiKey },
    { contents: [{ parts: [{ text: question }] }], tools: [{ google_search: {} }] },
  );
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  // Grounding URIs are Google redirect links; the chunk title carries the source domain.
  const citations: Citation[] = (candidate?.groundingMetadata?.groundingChunks ?? [])
    .map((c: { web?: { uri: string; title?: string } }) => c.web)
    .filter(Boolean)
    .map((w: { uri: string; title?: string }) => ({
      url: w.uri,
      title: w.title ?? null,
      domain: w.title && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(w.title) ? bareDomain(w.title) : bareDomain(w.uri),
    }));
  return { text, citations: dedupe(citations), model };
}

async function askAnthropic(question: string): Promise<EngineAnswer> {
  const { apiKey, model } = config.engines.anthropic;
  const data = await post(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    {
      model,
      max_tokens: 2000,
      messages: [{ role: "user", content: question }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    },
  );
  let text = "";
  const cited: Citation[] = [];
  const searched: Citation[] = [];
  for (const block of data.content ?? []) {
    if (block.type === "text") {
      text += block.text;
      for (const c of block.citations ?? []) if (c.url) cited.push(toCitation(c.url, c.title ?? null));
    } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) if (r.url) searched.push(toCitation(r.url, r.title ?? null));
    }
  }
  return { text, citations: dedupe(cited.length ? cited : searched), model };
}

const ADAPTERS: Record<EngineName, (q: string) => Promise<EngineAnswer>> = {
  openai: askOpenAI,
  perplexity: askPerplexity,
  gemini: askGemini,
  anthropic: askAnthropic,
};

export const ENGINE_LABELS: Record<EngineName, string> = {
  openai: "ChatGPT (web search)",
  perplexity: "Perplexity",
  gemini: "Gemini (Google Search grounding)",
  anthropic: "Claude (web search)",
};

export const enabledEngines = () =>
  (Object.keys(config.engines) as EngineName[]).filter((name) => config.engines[name].enabled);

export const askEngine = (engine: EngineName, question: string) =>
  timed(engine, "engine.ask", () => ADAPTERS[engine](question), { model: config.engines[engine].model, question });
