import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import { db } from "./db";

type Context = { userId?: string; auditId?: string };
const context = new AsyncLocalStorage<Context>();

/** Runs `fn` with user/audit ids attached to every event recorded inside it. */
export const withContext = <T>(ctx: Context, fn: () => Promise<T>) => context.run({ ...context.getStore(), ...ctx }, fn);

export type EventInput = {
  type: string;
  level?: "info" | "warn" | "error";
  userId?: string | null;
  auditId?: string | null;
  provider?: string;
  operation?: string;
  status?: string;
  durationMs?: number;
  message?: string;
  data?: Prisma.InputJsonValue;
};

/** Records an event. Never throws: observability must not break the request. */
export function track(event: EventInput) {
  const ctx = context.getStore();
  const row = {
    ...event,
    level: event.level ?? "info",
    userId: event.userId ?? ctx?.userId ?? null,
    auditId: event.auditId ?? ctx?.auditId ?? null,
    message: event.message?.slice(0, 2000),
  };
  return db.event.create({ data: row }).catch((e) => console.error("[observe] failed to record event", e.message, row.type));
}

/** Times an external call and records it as an `api.call` event, success or failure. */
export async function timed<T>(provider: string, operation: string, fn: () => Promise<T>, data?: Prisma.InputJsonValue): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    void track({ type: "api.call", provider, operation, status: "ok", durationMs: Date.now() - started, data });
    return result;
  } catch (e) {
    void track({ type: "api.call", level: "error", provider, operation, status: "error", durationMs: Date.now() - started, message: (e as Error).message, data });
    throw e;
  }
}
