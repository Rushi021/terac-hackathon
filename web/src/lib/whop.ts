import { WhopClient } from "@whop/sdk";
import { config } from "./config";
import { timed } from "./observe";

let client: WhopClient | null = null;

export function whop() {
  if (!config.whop.apiKey) throw new Error("WHOP_API_KEY is not set");
  client ??= new WhopClient({ token: config.whop.apiKey });
  return client;
}

/** Hosted Whop checkout for the configured plan, tagged with our user id so the webhook can credit them. */
export async function createCheckoutUrl(userId: string) {
  if (!config.whop.planId) throw new Error("WHOP_PLAN_ID is not set");
  const checkout = await timed("whop", "checkout.create", () =>
    whop().checkoutConfigurations.create({
      plan_id: config.whop.planId,
      metadata: { customer_id: userId },
      redirect_url: `${config.appUrl}/billing?status=success`,
    }),
  );
  return checkout.purchase_url;
}
