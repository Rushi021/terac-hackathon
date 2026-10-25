import { z } from "zod";
import { createSessionToken, hashPassword, publicUser, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientKind, error, json, parseBody } from "@/lib/http";
import { track } from "@/lib/observe";

const schema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().max(100).optional(),
});

export async function POST(req: Request) {
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const { email, password, name } = body.data;

  if (await db.user.findUnique({ where: { email } })) return error("An account with this email already exists", 409);
  const user = await db.user.create({ data: { email, name, passwordHash: await hashPassword(password), lastLoginAt: new Date() } });
  void track({ type: "auth.signup", userId: user.id, data: { email, client: clientKind(req) } });

  const token = await createSessionToken(user.id);
  const res = json({ token, user: publicUser(user) }, 201);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}
