import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { authorizeUrl } from "@/lib/google/oauth";

export const runtime = "nodejs";

/**
 * Kicks off the Google OAuth flow.
 * Stores a CSRF token in a cookie so the callback can verify it.
 */
export async function GET() {
  const state = crypto.randomBytes(16).toString("hex");
  const url = authorizeUrl(state);

  const res = NextResponse.redirect(url);
  res.cookies.set("g_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600, // 10 minutes
    path: "/",
  });
  return res;
}
