import { getRequestUser, isAdmin, publicUser } from "@/lib/auth";
import { integrationStatus } from "@/lib/config";
import { error, json } from "@/lib/http";

export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return error("Not signed in", 401);
  return json({ user: { ...publicUser(user), isAdmin: isAdmin(user) }, integrations: integrationStatus() });
}
