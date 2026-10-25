import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { config } from "./config";
import { db } from "./db";

export const SESSION_COOKIE = "aivis_session";
const SESSION_DAYS = 30;

function secretKey() {
  if (!config.authSecret) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(config.authSecret);
}

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export async function createSessionToken(userId: string) {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

async function userFromToken(token: string | undefined | null): Promise<User | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub) return null;
    return await db.user.findUnique({ where: { id: payload.sub } });
  } catch {
    return null;
  }
}

/** Resolves the user from a Bearer token (browser extension) or the session cookie (web app). */
export async function getRequestUser(req: Request): Promise<User | null> {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return userFromToken(header.slice(7));
  return getSessionUser();
}

/** For server components and server actions. */
export async function getSessionUser(): Promise<User | null> {
  const store = await cookies();
  return userFromToken(store.get(SESSION_COOKIE)?.value);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_DAYS * 24 * 60 * 60,
};

export function isAdmin(user: Pick<User, "email"> | null) {
  return !!user && config.adminEmails.includes(user.email.toLowerCase());
}

export function publicUser(user: User) {
  return { id: user.id, email: user.email, name: user.name, plan: user.plan, auditCredits: user.auditCredits };
}
