import { getRequestUser, SESSION_COOKIE } from "@/lib/auth";
import { json } from "@/lib/http";
import { track } from "@/lib/observe";

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (user) void track({ type: "auth.logout", userId: user.id });
  const res = json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
