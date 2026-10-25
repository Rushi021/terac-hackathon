import { NextResponse } from "next/server";
import type { ZodType } from "zod";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const error = (message: string, status = 400, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error: message, ...extra }, { status });

/** "extension" for calls from the browser extension, "web" otherwise. */
export const clientKind = (req: Request) =>
  /^(chrome|moz)-extension:\/\//.test(req.headers.get("origin") ?? "") ? "extension" : "web";

export async function parseBody<T>(req: Request, schema: ZodType<T>) {
  const raw = await req.json().catch(() => null);
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false as const, response: error(result.error.issues[0]?.message ?? "Invalid request") };
  }
  return { ok: true as const, data: result.data };
}
