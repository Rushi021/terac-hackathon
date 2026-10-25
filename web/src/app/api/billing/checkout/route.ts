import { getRequestUser } from "@/lib/auth";
import { error, json } from "@/lib/http";
import { createCheckoutUrl } from "@/lib/whop";

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return error("Not signed in", 401);
  try {
    return json({ url: await createCheckoutUrl(user.id) });
  } catch (e) {
    return error((e as Error).message, 503);
  }
}
