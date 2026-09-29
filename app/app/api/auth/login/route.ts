import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, newSessionValue, verifyPassword, verifyTotp } from "@/lib/auth";
import { sql } from "@/lib/db";
import { logActivity } from "@/lib/data";

const WINDOW_MIN = 15, MAX_FAILS = 5;

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.nextUrl.host) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const [{ n }] = await sql()`select count(*)::int as n from login_attempts where ip = ${ip} and not ok and at > now() - (${WINDOW_MIN} || ' minutes')::interval`;
  if (n >= MAX_FAILS) return NextResponse.json({ error: `Too many attempts. Try again in ${WINDOW_MIN} minutes.` }, { status: 429 });

  const form = await req.formData();
  const pw = String(form.get("password") || ""), code = String(form.get("code") || "").replace(/\s/g, "");
  // Check both every time so a wrong code doesn't reveal whether the password was right.
  const okPw = verifyPassword(pw, process.env.JARVIS_PASSWORD_HASH);
  const okCode = verifyTotp(code, process.env.JARVIS_TOTP_SECRET);
  await sql()`insert into login_attempts (ip, ok) values (${ip}, ${okPw && okCode})`;
  if (!okPw || !okCode) return NextResponse.json({ error: "That password and code don't match." }, { status: 401 });

  const s = newSessionValue();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, s.value, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: s.maxAge });
  await logActivity("login", "/login");
  return res;
}
