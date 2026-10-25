import { z } from "zod";
import { createSessionToken, publicUser, SESSION_COOKIE, sessionCookieOptions, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientKind, error, json, parseBody } from "@/lib/http";
import { track } from "@/lib/observe";

const schema = z.object({ email: z.string().transform((e) => e.toLowerCase().trim()), password: z.string() });

export async function POST(req: Request) {
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const user = await db.user.findUnique({ where: { email: body.data.email } });
  if (!user || !(await verifyPassword(body.data.password, user.passwordHash))) {
    void track({ type: "auth.login", level: "warn", status: "error", userId: user?.id, message: user ? "wrong password" : "unknown email", data: { email: body.data.email, client: clientKind(req) } });
    return error("Invalid email or password", 401);
  }
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  void track({ type: "auth.login", status: "ok", userId: user.id, data: { client: clientKind(req) } });
  const token = await createSessionToken(user.id);
  const res = json({ token, user: publicUser(user) });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}
