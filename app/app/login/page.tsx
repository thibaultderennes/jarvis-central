"use client";
import { useState } from "react";

export default function Login() {
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setErr("");
    const res = await fetch("/api/auth/login", { method: "POST", body: new FormData(e.currentTarget) });
    if (res.ok) { window.location.href = "/"; return; }
    setErr((await res.json().catch(() => ({}))).error || "Couldn't sign in. Try again.");
    setBusy(false);
  }
  return (
    <main className="login">
      <form onSubmit={submit}>
        <div className="word"><i className="pulse" aria-hidden="true" />Jarvis <span>Central</span></div>
        <label>Password<input className="input" type="password" name="password" autoComplete="current-password" required autoFocus /></label>
        <label>6-digit code from your authenticator app<input className="input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required /></label>
        <button className="btn" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <div className="err" role="alert">{err}</div>
      </form>
    </main>
  );
}
