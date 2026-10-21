import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, sessionOk } from "@/lib/auth";
import { bumpSessionEpoch } from "@/lib/sessionEpoch";

/** Log out ends every session (the owner's only account): a copied cookie stops working too. */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  let sameSite = !origin;
  try { sameSite = sameSite || new URL(origin!).host === req.nextUrl.host; } catch {}
  if (!sameSite) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  if (await sessionOk(req.cookies.get(COOKIE)?.value)) await bumpSessionEpoch();
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.set(COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
