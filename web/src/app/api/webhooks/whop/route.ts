import { unwrapWebhook } from "@whop/sdk/helpers";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { error, json } from "@/lib/http";
import { track } from "@/lib/observe";

export const runtime = "nodejs";

type WhopEvent = {
  id: string;
  type: string;
  data: {
    id?: string;
    user_id?: string;
    user?: { id?: string };
    membership_id?: string;
    membership?: { id?: string };
    metadata?: Record<string, string> | null;
  };
};

export async function POST(req: Request) {
  const raw = await req.text();
  let event: WhopEvent;
  try {
    event = unwrapWebhook<WhopEvent>(raw, { headers: Object.fromEntries(req.headers), key: config.whop.webhookSecret || undefined });
  } catch (e) {
    void track({ type: "webhook.whop", level: "warn", provider: "whop", status: "rejected", message: (e as Error).message });
    return error(`Invalid webhook: ${(e as Error).message}`, 400);
  }

  const deliveryId = req.headers.get("webhook-id") ?? event.id;
  if (await db.webhookEvent.findUnique({ where: { id: deliveryId } })) return json({ ok: true, duplicate: true });
  await db.webhookEvent.create({ data: { id: deliveryId, provider: "whop", type: event.type, payload: raw } });

  const customerId = event.data.metadata?.customer_id;
  const user = customerId ? await db.user.findUnique({ where: { id: customerId } }) : null;
  void track({
    type: "webhook.whop",
    level: user ? "info" : "warn",
    provider: "whop",
    operation: event.type,
    status: user ? "ok" : "no_customer",
    userId: user?.id,
    data: { deliveryId, whopObjectId: event.data.id ?? null },
  });
  if (!user) return json({ ok: true, ignored: "no matching customer" });

  const whopUserId = event.data.user_id ?? event.data.user?.id;
  if (event.type === "payment.succeeded") {
    await db.user.update({
      where: { id: user.id },
      data: { plan: "pro", auditCredits: { increment: config.whop.creditsPerPayment }, whopUserId: whopUserId ?? user.whopUserId },
    });
  } else if (event.type === "membership.activated") {
    await db.user.update({
      where: { id: user.id },
      data: { plan: "pro", whopUserId: whopUserId ?? user.whopUserId, whopMembershipId: event.data.id ?? user.whopMembershipId },
    });
  } else if (event.type === "membership.deactivated") {
    await db.user.update({ where: { id: user.id }, data: { plan: "free" } });
  }
  return json({ ok: true });
}
