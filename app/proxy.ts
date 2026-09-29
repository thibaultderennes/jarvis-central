import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, validSession } from "@/lib/auth";

// First line of defence. Every page and Server Function also calls requireSession().
export function proxy(req: NextRequest) {
  if (validSession(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/auth|api/agent|api/cal|_next/static|_next/image|favicon.ico|icon|apple-icon|robots.txt).*)"],
};
