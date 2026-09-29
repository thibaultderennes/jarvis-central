import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, newSessionValue } from "@/lib/auth";

// Local development only: signs in without the password so the UI can be checked on localhost.
// Returns 404 in any production build, and needs JARVIS_DEV_LOGIN set in .env.local.
export async function GET(req: NextRequest) {
  const key = process.env.JARVIS_DEV_LOGIN;
  if (process.env.NODE_ENV !== "development" || !key || req.nextUrl.searchParams.get("key") !== key) return new NextResponse("Not found", { status: 404 });
  const s = newSessionValue();
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(COOKIE, s.value, { httpOnly: true, sameSite: "lax", path: "/", maxAge: s.maxAge });
  return res;
}
