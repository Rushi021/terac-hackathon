import { NextResponse, type NextRequest } from "next/server";

// The browser extension calls the API from a chrome-extension:// origin with a
// Bearer token (no cookies), so only those origins get CORS access.
export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin") ?? "";
  const fromExtension = /^(chrome|moz)-extension:\/\//.test(origin);
  if (!fromExtension) return NextResponse.next();

  const headers = {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-max-age": "86400",
  };
  if (req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers });
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export const config = { matcher: "/api/:path*" };
