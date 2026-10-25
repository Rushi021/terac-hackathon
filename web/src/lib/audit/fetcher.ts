export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export type FetchResult = {
  ok: boolean;
  status: number;
  finalUrl: string;
  ms: number;
  body: string;
  headers: Headers | null;
  error: string | null;
};

const MAX_BODY = 2_000_000;

export async function fetchPage(url: string, userAgent = BROWSER_UA, timeoutMs = 15_000): Promise<FetchResult> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "user-agent": userAgent, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.text()).slice(0, MAX_BODY);
    return { ok: res.ok, status: res.status, finalUrl: res.url || url, ms: Date.now() - started, body, headers: res.headers, error: null };
  } catch (e) {
    return { ok: false, status: 0, finalUrl: url, ms: Date.now() - started, body: "", headers: null, error: (e as Error).message };
  }
}

export function normalizeUrl(input: string): URL {
  const trimmed = input.trim();
  const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  url.hash = "";
  return url;
}

/** Hostname without a leading "www." — good enough to compare a brand's own domain against citations. */
export function bareDomain(hostOrUrl: string): string {
  try {
    const host = hostOrUrl.includes("://") ? new URL(hostOrUrl).hostname : hostOrUrl;
    return host.toLowerCase().replace(/^www\./, "");
  } catch {
    return hostOrUrl.toLowerCase();
  }
}

export function sameSite(a: string, b: string) {
  const da = bareDomain(a);
  const db = bareDomain(b);
  return da === db || da.endsWith(`.${db}`) || db.endsWith(`.${da}`);
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
