import { config } from "./config";
import { track } from "./observe";

export const llmAvailable = () => !!config.openai.apiKey;

/** Chat completion constrained to a JSON object. Throws when the LLM is not configured. */
export async function llmJson<T>(system: string, user: string, opts: { temperature?: number } = {}): Promise<T> {
  if (!config.openai.apiKey) throw new Error("OPENAI_API_KEY is not set");
  const started = Date.now();
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${config.openai.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: config.openai.model,
        temperature: opts.temperature ?? 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    void track({
      type: "api.call",
      provider: "openai",
      operation: "llm.json",
      status: "ok",
      durationMs: Date.now() - started,
      data: { model: config.openai.model, promptTokens: data.usage?.prompt_tokens ?? null, completionTokens: data.usage?.completion_tokens ?? null },
    });
    return JSON.parse(data.choices[0].message.content) as T;
  } catch (e) {
    void track({ type: "api.call", level: "error", provider: "openai", operation: "llm.json", status: "error", durationMs: Date.now() - started, message: (e as Error).message, data: { model: config.openai.model } });
    throw e;
  }
}
