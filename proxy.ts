import { NextRequest, NextResponse } from "next/server";
export function proxy(request: NextRequest) {
  const current = request.cookies.get("c4pid")?.value;
  if (current && /^p-[0-9a-f-]{36}$/.test(current)) return NextResponse.next();
  const player = crypto.randomUUID();
  request.cookies.set("c4pid", `p-${player}`);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set("c4pid", `p-${player}`, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return response;
}
export const config = { matcher: ["/", "/play/:path*", "/wall", "/api/:path*"] };
